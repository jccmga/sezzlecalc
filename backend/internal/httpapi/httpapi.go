// Package httpapi provides the calculator HTTP handlers, request/response
// types, panic recovery, and the single error-to-status mapper.
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

const (
	maxBodyBytes = 1024
	unaryArity   = 1
	binaryArity  = 2
)

var (
	errInvalidInput     = errors.New("invalid input")
	errMethodNotAllowed = errors.New("method not allowed")
	errInternal         = errors.New("internal error")
)

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

func (s *server) evaluateHandler(w http.ResponseWriter, r *http.Request) {
	if err := requirePost(r); err != nil {
		s.writeError(w, err)
		return
	}

	if err := requireJSONContentType(r); err != nil {
		s.writeError(w, err)
		return
	}

	req, err := decodeEvaluateRequest(w, r)
	if err != nil {
		s.writeError(w, err)
		return
	}

	if err := validateOperands(req); err != nil {
		s.writeError(w, err)
		return
	}

	result, err := calc.Evaluate(req.Operation, operandValue(req.A), operandValue(req.B))
	if err != nil {
		s.writeError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, evaluateResponse{Result: result})
}

func requirePost(r *http.Request) error {
	if r.Method != http.MethodPost {
		return errMethodNotAllowed
	}

	return nil
}

func requireJSONContentType(r *http.Request) error {
	mediatype, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediatype != "application/json" {
		return errInvalidInput
	}

	return nil
}

func decodeEvaluateRequest(w http.ResponseWriter, r *http.Request) (*evaluateRequest, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)

	dec := json.NewDecoder(r.Body)

	var req evaluateRequest
	if err := dec.Decode(&req); err != nil {
		return nil, fmt.Errorf("%w: %w", errInvalidInput, err)
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, fmt.Errorf("%w: trailing data", errInvalidInput)
	}

	return &req, nil
}

func validateOperands(req *evaluateRequest) error {
	if err := validateOperandPresence(req); err != nil {
		return err
	}

	return validateOperandFiniteness(req)
}

func validateOperandPresence(req *evaluateRequest) error {
	arity, known := calc.Arity(req.Operation)
	if !known {
		return nil
	}

	if req.A == nil {
		return errInvalidInput
	}

	switch arity {
	case binaryArity:
		if req.B == nil {
			return errInvalidInput
		}
	case unaryArity:
		if req.B != nil {
			return errInvalidInput
		}
	}

	return nil
}

func validateOperandFiniteness(req *evaluateRequest) error {
	if req.A != nil && isNonFinite(*req.A) {
		return errInvalidInput
	}
	if req.B != nil && isNonFinite(*req.B) {
		return errInvalidInput
	}

	return nil
}

func isNonFinite(operand float64) bool {
	return math.IsNaN(operand) || math.IsInf(operand, 0)
}

func operandValue(operand *float64) float64 {
	if operand == nil {
		return 0
	}

	return *operand
}

func (s *server) healthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.writeError(w, errMethodNotAllowed)
		return
	}

	writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
}

func (s *server) writeError(w http.ResponseWriter, err error) {
	var status int
	var message string

	switch {
	case errors.Is(err, errInvalidInput):
		status, message = http.StatusBadRequest, "invalid input"
	case errors.Is(err, calc.ErrDivideByZero):
		status, message = http.StatusUnprocessableEntity, "division by zero"
	case errors.Is(err, calc.ErrSqrtNegative):
		status, message = http.StatusUnprocessableEntity, "square root of negative number"
	case errors.Is(err, calc.ErrUnknownOperation):
		status, message = http.StatusUnprocessableEntity, "invalid operation"
	case errors.Is(err, calc.ErrNonFiniteResult):
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

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
