package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// serve drives a handler end-to-end via httptest. setCT controls whether the
// Content-Type header is set; absent and empty are the same to Header.Get.
func serve(t *testing.T, h http.Handler, method, path, body string, setCT bool, ct string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if setCT {
		req.Header.Set("Content-Type", ct)
	}

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	return rec
}

// decodeEnvelope decodes the body into raw key→value for shape assertions.
func decodeEnvelope(t *testing.T, rec *httptest.ResponseRecorder) map[string]json.RawMessage {
	t.Helper()

	var env map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &env))

	return env
}

// assertErrorBody asserts Content-Type, error-key-present/result-key-absent,
// and the exact error string.
func assertErrorBody(t *testing.T, rec *httptest.ResponseRecorder, wantMsg string) {
	t.Helper()

	require.Equal(t, "application/json", rec.Header().Get("Content-Type"))

	env := decodeEnvelope(t, rec)
	require.Contains(t, env, "error")
	require.NotContains(t, env, "result")

	var got errorResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
	require.Equal(t, wantMsg, got.Error)
}

func TestNewHandlerNilLogger(t *testing.T) {
	var h http.Handler

	require.NotPanics(t, func() { h = NewHandler(nil) })
	require.NotNil(t, h)
}

func TestEvaluate(t *testing.T) {
	const ct = "application/json"

	cases := []struct {
		name       string
		body       string
		wantStatus int
		wantResult float64
		wantError  string
	}{
		{"add/fractional", `{"operation":"add","a":1.5,"b":2.5}`, http.StatusOK, 4, ""},
		{"subtract", `{"operation":"subtract","a":5,"b":2}`, http.StatusOK, 3, ""},
		{"multiply", `{"operation":"multiply","a":3,"b":4}`, http.StatusOK, 12, ""},
		{"divide", `{"operation":"divide","a":8,"b":2}`, http.StatusOK, 4, ""},
		{"divide/negative-divisor", `{"operation":"divide","a":8,"b":-2}`, http.StatusOK, -4, ""},
		{"divide/fraction", `{"operation":"divide","a":1,"b":2}`, http.StatusOK, 0.5, ""},
		{"divide-by-zero/positive", `{"operation":"divide","a":5,"b":0}`, http.StatusUnprocessableEntity, 0, "division by zero"},
		{"unknown/mod", `{"operation":"mod","a":8,"b":2}`, http.StatusUnprocessableEntity, 0, "invalid operation"},
		{"unknown/empty", `{"operation":"","a":8,"b":2}`, http.StatusUnprocessableEntity, 0, "invalid operation"},
		{"unknown/power", `{"operation":"power","a":8,"b":2}`, http.StatusUnprocessableEntity, 0, "invalid operation"},
		{"unknown/sqrt", `{"operation":"sqrt","a":8,"b":2}`, http.StatusUnprocessableEntity, 0, "invalid operation"},
		{"unknown/percent", `{"operation":"percent","a":8,"b":2}`, http.StatusUnprocessableEntity, 0, "invalid operation"},
		{"non-finite/result", `{"operation":"multiply","a":1e308,"b":1e308}`, http.StatusUnprocessableEntity, 0, "non-finite result"},
		{"bad-json", `{"operation":`, http.StatusBadRequest, 0, "invalid input"},
		{"empty-body", ``, http.StatusBadRequest, 0, "invalid input"},
		{"trailing-data", `{"operation":"add","a":1,"b":2} extra`, http.StatusBadRequest, 0, "invalid input"},
		{"missing-a", `{"operation":"add","b":2}`, http.StatusBadRequest, 0, "invalid input"},
		{"missing-b", `{"operation":"add","a":1}`, http.StatusBadRequest, 0, "invalid input"},
		{"null-a", `{"operation":"add","a":null,"b":2}`, http.StatusBadRequest, 0, "invalid input"},
		{"null-b", `{"operation":"add","a":1,"b":null}`, http.StatusBadRequest, 0, "invalid input"},
		{"wrong-type-a", `{"operation":"add","a":"x","b":2}`, http.StatusBadRequest, 0, "invalid input"},
		{"wrong-type-operation", `{"operation":3,"a":1,"b":2}`, http.StatusBadRequest, 0, "invalid input"},
		{"overflow-1e400", `{"operation":"add","a":1e400,"b":2}`, http.StatusBadRequest, 0, "invalid input"},
		{"nan-literal", `{"operation":"add","a":NaN,"b":2}`, http.StatusBadRequest, 0, "invalid input"},
		{"infinity-literal", `{"operation":"add","a":Infinity,"b":2}`, http.StatusBadRequest, 0, "invalid input"},
	}

	h := NewHandler(nil)

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := serve(t, h, http.MethodPost, "/evaluate", tc.body, true, ct)

			require.Equal(t, tc.wantStatus, rec.Code)
			require.Equal(t, "application/json", rec.Header().Get("Content-Type"))

			if tc.wantError != "" {
				assertErrorBody(t, rec, tc.wantError)
				return
			}

			env := decodeEnvelope(t, rec)
			require.Contains(t, env, "result")
			require.NotContains(t, env, "error")

			var got evaluateResponse
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
			require.Equal(t, tc.wantResult, got.Result)
		})
	}
}

func TestEvaluateNegativeZeroDivisor(t *testing.T) {
	negZero := math.Copysign(0, -1)

	body, err := json.Marshal(map[string]any{"operation": "divide", "a": 5, "b": negZero})
	require.NoError(t, err)

	// Guard: a plain -0.0 in Go collapses to +0.0, so assert the wire bytes
	// actually carry a negative zero before exercising the handler.
	require.Contains(t, string(body), `"b":-0`)

	rec := serve(t, NewHandler(nil), http.MethodPost, "/evaluate", string(body), true, "application/json")

	require.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assertErrorBody(t, rec, "division by zero")
}

func TestEvaluateContentType(t *testing.T) {
	const body = `{"operation":"add","a":1,"b":2}`

	cases := []struct {
		name       string
		setCT      bool
		ct         string
		wantStatus int
	}{
		{"absent", false, "", http.StatusBadRequest},
		{"text-plain", true, "text/plain", http.StatusBadRequest},
		{"xml", true, "application/xml", http.StatusBadRequest},
		{"json-patch", true, "application/json-patch+json", http.StatusBadRequest},
		{"malformed", true, ";;;", http.StatusBadRequest},
		{"charset-accepted", true, "application/json; charset=utf-8", http.StatusOK},
		{"case-insensitive", true, "Application/JSON", http.StatusOK},
	}

	h := NewHandler(nil)

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := serve(t, h, http.MethodPost, "/evaluate", body, tc.setCT, tc.ct)

			require.Equal(t, tc.wantStatus, rec.Code)

			if tc.wantStatus == http.StatusOK {
				var got evaluateResponse
				require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
				require.Equal(t, 3.0, got.Result)
				return
			}

			assertErrorBody(t, rec, "invalid input")
		})
	}
}

// paddedBody builds a valid evaluate body of exactly target bytes using an
// ignored unknown field as padding.
func paddedBody(t *testing.T, target int) string {
	t.Helper()

	const prefix = `{"operation":"add","a":1,"b":2,"x":"`
	const suffix = `"}`

	pad := target - len(prefix) - len(suffix)
	require.GreaterOrEqual(t, pad, 0)

	body := prefix + strings.Repeat("A", pad) + suffix
	require.Len(t, body, target)

	return body
}

func TestEvaluateBodyCap(t *testing.T) {
	body := `{"operation":"add","a":1,"b":2,"x":"` + strings.Repeat("A", 2048) + `"}`
	require.Greater(t, len(body), maxBodyBytes)

	rec := serve(t, NewHandler(nil), http.MethodPost, "/evaluate", body, true, "application/json")

	require.Equal(t, http.StatusBadRequest, rec.Code)
	assertErrorBody(t, rec, "invalid input")
}

func TestEvaluateBodyCapBoundary(t *testing.T) {
	h := NewHandler(nil)

	atLimit := serve(t, h, http.MethodPost, "/evaluate", paddedBody(t, maxBodyBytes), true, "application/json")
	require.Equal(t, http.StatusOK, atLimit.Code)

	overLimit := serve(t, h, http.MethodPost, "/evaluate", paddedBody(t, maxBodyBytes+1), true, "application/json")
	require.Equal(t, http.StatusBadRequest, overLimit.Code)
	assertErrorBody(t, overLimit, "invalid input")
}

func TestMethodNotAllowed(t *testing.T) {
	h := NewHandler(nil)

	evaluateMethods := []string{
		http.MethodGet,
		http.MethodPut,
		http.MethodDelete,
		http.MethodPatch,
		http.MethodHead,
		http.MethodOptions,
	}
	for _, method := range evaluateMethods {
		t.Run("evaluate/"+method, func(t *testing.T) {
			rec := serve(t, h, method, "/evaluate", "", true, "application/json")

			require.Equal(t, http.StatusMethodNotAllowed, rec.Code)
			assertErrorBody(t, rec, "method not allowed")
		})
	}

	healthMethods := []string{
		http.MethodPost,
		http.MethodPut,
		http.MethodDelete,
		http.MethodPatch,
		http.MethodHead,
		http.MethodOptions,
	}
	for _, method := range healthMethods {
		t.Run("health/"+method, func(t *testing.T) {
			rec := serve(t, h, method, "/health", "", false, "")

			require.Equal(t, http.StatusMethodNotAllowed, rec.Code)
			assertErrorBody(t, rec, "method not allowed")
		})
	}
}

func TestHealth(t *testing.T) {
	rec := serve(t, NewHandler(nil), http.MethodGet, "/health", "", false, "")

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "application/json", rec.Header().Get("Content-Type"))

	env := decodeEnvelope(t, rec)
	require.Len(t, env, 1)
	require.Contains(t, env, "status")

	var got healthResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
	require.Equal(t, "ok", got.Status)
}

func TestUnknownPath(t *testing.T) {
	rec := serve(t, NewHandler(nil), http.MethodGet, "/nope", "", false, "")

	require.Equal(t, http.StatusNotFound, rec.Code)
	require.Contains(t, rec.Body.String(), "404 page not found")
	require.NotContains(t, rec.Body.String(), `"error"`)
}

func TestPanicRecovery(t *testing.T) {
	var buf bytes.Buffer

	s := &server{logger: slog.New(slog.NewTextHandler(&buf, nil))}
	panicking := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("boom") })

	rec := serve(t, s.recover(panicking), http.MethodGet, "/", "", false, "")

	require.Equal(t, http.StatusInternalServerError, rec.Code)
	assertErrorBody(t, rec, "internal error")

	require.Contains(t, buf.String(), "boom")
	require.Contains(t, buf.String(), "goroutine")
	require.NotContains(t, rec.Body.String(), "boom")
	require.NotContains(t, rec.Body.String(), "goroutine")
}

func TestWriteErrorDefault(t *testing.T) {
	var buf bytes.Buffer

	s := &server{logger: slog.New(slog.NewTextHandler(&buf, nil))}
	rec := httptest.NewRecorder()

	s.writeError(rec, errors.New("unexpected internal detail"))

	require.Equal(t, http.StatusInternalServerError, rec.Code)
	assertErrorBody(t, rec, "internal error")
	require.NotContains(t, rec.Body.String(), "unexpected internal detail")
}
