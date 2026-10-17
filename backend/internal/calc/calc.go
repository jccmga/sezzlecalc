// Package calc provides stateless arithmetic operations.
package calc

import (
	"errors"
	"math"
	"strings"
)

var (
	ErrDivideByZero     = errors.New("division by zero")
	ErrSqrtNegative     = errors.New("square root of negative number")
	ErrNonFiniteResult  = errors.New("non-finite result")
	ErrUnknownOperation = errors.New("unknown operation")
)

// Evaluate applies operation to a and b, returning the result.
// Unary operations ignore b.
func Evaluate(operation string, a, b float64) (float64, error) {
	op := strings.ToLower(strings.TrimSpace(operation))

	var result float64

	switch op {
	case "add":
		result = a + b
	case "subtract":
		result = a - b
	case "multiply":
		result = a * b
	case "divide":
		if b == 0 {
			return 0, ErrDivideByZero
		}

		result = a / b
	case "power":
		result = math.Pow(a, b)
	case "sqrt":
		if a < 0 {
			return 0, ErrSqrtNegative
		}

		result = math.Sqrt(a)
	case "percent":
		result = a / 100
	default:
		return 0, ErrUnknownOperation
	}

	if math.IsNaN(result) || math.IsInf(result, 0) {
		return 0, ErrNonFiniteResult
	}

	return result, nil
}

// Arity reports the number of operands an operation requires.
func Arity(operation string) (int, bool) {
	switch strings.ToLower(strings.TrimSpace(operation)) {
	case "sqrt", "percent":
		return 1, true
	case "add", "subtract", "multiply", "divide", "power":
		return 2, true
	default:
		return 0, false
	}
}
