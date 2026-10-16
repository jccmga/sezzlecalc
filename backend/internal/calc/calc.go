// Package calc provides stateless arithmetic operations.
//
// Errors are returned as sentinel values (ErrDivideByZero, ErrUnknownOperation)
// that callers should match with errors.Is.
package calc

import (
	"errors"
	"strings"
)

var (
	// ErrDivideByZero is returned when dividing by a zero divisor.
	ErrDivideByZero = errors.New("division by zero")

	// ErrUnknownOperation is returned when the operation name is not one
	// of add, subtract, multiply, or divide after normalization.
	ErrUnknownOperation = errors.New("unknown operation")
)

// Evaluate applies operation to a and b, returning the result.
//
// The operation name is matched after trimming surrounding whitespace and
// case-folding, so "Add", " add ", and "ADD" all resolve to add.
func Evaluate(operation string, a, b float64) (float64, error) {
	op := strings.ToLower(strings.TrimSpace(operation))

	switch op {
	case "add":
		return a + b, nil
	case "subtract":
		return a - b, nil
	case "multiply":
		return a * b, nil
	case "divide":
		if b == 0 {
			return 0, ErrDivideByZero
		}

		return a / b, nil
	default:
		return 0, ErrUnknownOperation
	}
}
