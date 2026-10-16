// Package httpapi provides the calculator HTTP handlers, request/response
// types, panic recovery, and the single error-to-status mapper.
//
// NewHandler is the only exported symbol. It builds the routing surface
// (POST /evaluate and GET /health), wraps it in panic recovery, and returns
// the fully wired http.Handler.
package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"mime"
	"net/http"
	"runtime/debug"

	"sezzlecalc/backend/internal/calc"
)

// maxBodyBytes caps the JSON request body; the limit is inclusive.
const maxBodyBytes = 1024

// Local sentinels, matched only by writeError. They carry the client-safe
// meaning; writeError is the sole chooser of a status code and client string.
var (
	errInvalidInput     = errors.New("invalid input")
	errNonFiniteResult  = errors.New("non-finite result")
	errMethodNotAllowed = errors.New("method not allowed")
	errInternal         = errors.New("internal error")
)

// server carries the injected logger used for server-side error reporting.
type server struct {
	logger *slog.Logger
}

// NewHandler builds the calculator HTTP handler. A nil logger falls back to
// slog.Default(), so NewHandler(nil) is safe.
func NewHandler(logger *slog.Logger) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}

	s := &server{logger: logger}

	mux := http.NewServeMux()
	mux.HandleFunc("/evaluate", s.evaluateHandler)
	mux.HandleFunc("/health", s.healthHandler)

	return s.recover(mux)
}

// evaluateRequest is the POST /evaluate body. A and B are pointers so a missing
// or explicit null operand stays distinguishable from a legitimate 0.
type evaluateRequest struct {
	Operation string   `json:"operation"`
	A         *float64 `json:"a"`
	B         *float64 `json:"b"`
}

type evaluateResponse struct {
	Result float64 `json:"result"`
}

type errorResponse struct {
	Error string `json:"error"`
}

type healthResponse struct {
	Status string `json:"status"`
}

// evaluateHandler implements POST /evaluate. Checks run in a fixed order:
// method, Content-Type, body cap, decode, operand presence, operand
// finiteness, calc.Evaluate, result finiteness, success.
func (s *server) evaluateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		s.writeError(w, errMethodNotAllowed)
		return
	}

	mediatype, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediatype != "application/json" {
		s.writeError(w, errInvalidInput)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)

	dec := json.NewDecoder(r.Body)
	var req evaluateRequest
	if err := dec.Decode(&req); err != nil {
		s.writeError(w, fmt.Errorf("%w: %w", errInvalidInput, err))
		return
	}
	if _, err := dec.Token(); err != io.EOF {
		s.writeError(w, fmt.Errorf("%w: trailing data", errInvalidInput))
		return
	}

	if req.A == nil || req.B == nil {
		s.writeError(w, errInvalidInput)
		return
	}

	if math.IsNaN(*req.A) || math.IsInf(*req.A, 0) || math.IsNaN(*req.B) || math.IsInf(*req.B, 0) {
		s.writeError(w, errInvalidInput)
		return
	}

	result, err := calc.Evaluate(req.Operation, *req.A, *req.B)
	if err != nil {
		s.writeError(w, err)
		return
	}

	if math.IsNaN(result) || math.IsInf(result, 0) {
		s.writeError(w, errNonFiniteResult)
		return
	}

	writeJSON(w, http.StatusOK, evaluateResponse{Result: result})
}

// healthHandler implements GET /health. It reads no body and checks no
// Content-Type.
func (s *server) healthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.writeError(w, errMethodNotAllowed)
		return
	}

	writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
}

// writeError is the only place an error becomes a status code and a client-safe
// string. The raw error, wrapped cause, stack trace, and file paths never reach
// the body. 5xx are logged at error level, 4xx at debug.
func (s *server) writeError(w http.ResponseWriter, err error) {
	var status int
	var message string

	switch {
	case errors.Is(err, errInvalidInput):
		status, message = http.StatusBadRequest, "invalid input"
	case errors.Is(err, calc.ErrDivideByZero):
		status, message = http.StatusUnprocessableEntity, "division by zero"
	case errors.Is(err, calc.ErrUnknownOperation):
		status, message = http.StatusUnprocessableEntity, "invalid operation"
	case errors.Is(err, errNonFiniteResult):
		status, message = http.StatusUnprocessableEntity, "non-finite result"
	case errors.Is(err, errMethodNotAllowed):
		status, message = http.StatusMethodNotAllowed, "method not allowed"
	case errors.Is(err, errInternal):
		status, message = http.StatusInternalServerError, "internal error"
	default:
		status, message = http.StatusInternalServerError, "internal error"
	}

	if status >= http.StatusInternalServerError {
		s.logger.Error("request failed", "error", err)
	} else {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			s.logger.Debug("request body too large", "limit", maxBytesErr.Limit)
		} else {
			s.logger.Debug("invalid request", "error", err)
		}
	}

	writeJSON(w, status, errorResponse{Error: message})
}

// recover wraps next so a panicking handler is logged server-side and the client
// receives 500 {"error":"internal error"}. The panic value and stack are logged,
// never written to the body.
func (s *server) recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				s.logger.Error("panic recovered",
					"panic", rec,
					"stack", string(debug.Stack()))
				s.writeError(w, errInternal)
			}
		}()

		next.ServeHTTP(w, r)
	})
}

// writeJSON sets Content-Type before WriteHeader and encodes v.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
