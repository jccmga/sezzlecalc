package calc

import (
	"math"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNegativeZeroConstruction(t *testing.T) {
	negZero := math.Copysign(0, -1)

	require.Zero(t, negZero)

	require.True(t, math.Signbit(negZero))
}

func TestEvaluate(t *testing.T) {
	negZero := math.Copysign(0, -1)

	cases := []struct {
		name    string
		op      string
		a, b    float64
		want    float64
		wantErr error
	}{
		{"add/positive", "add", 2, 3, 5, nil},
		{"add/negative", "add", -2, -3, -5, nil},
		{"add/fractional", "add", 1.5, 0.25, 1.75, nil},
		{"add/zero", "add", 7, 0, 7, nil},

		{"subtract/positive", "subtract", 2, 3, -1, nil},
		{"subtract/negative", "subtract", -2, -3, 1, nil},
		{"subtract/fractional", "subtract", 0.5, 1.25, -0.75, nil},
		{"subtract/zero", "subtract", 7, 0, 7, nil},

		{"multiply/positive", "multiply", 2, 3, 6, nil},
		{"multiply/mixed-sign", "multiply", -2, 3, -6, nil},
		{"multiply/fractional", "multiply", 1.5, 2, 3, nil},
		{"multiply/zero", "multiply", 7, 0, 0, nil},

		{"divide/positive", "divide", 8, 2, 4, nil},
		{"divide/negative", "divide", -8, 2, -4, nil},
		{"divide/negative-divisor", "divide", 8, -2, -4, nil},
		{"divide/fractional", "divide", 1, 2, 0.5, nil},
		{"divide/zero-numerator", "divide", 0, 5, 0, nil},

		{"normalize/add/mixed-case", "Add", 2, 3, 5, nil},
		{"normalize/add/padded", " add ", 2, 3, 5, nil},
		{"normalize/add/upper", "ADD", 2, 3, 5, nil},
		{"normalize/subtract/padded", " subtract ", 2, 3, -1, nil},
		{"normalize/multiply/mixed-case", "MuLtIpLy", 3, 4, 12, nil},
		{"normalize/divide/padded", "  divide  ", 8, 2, 4, nil},

		{"unknown/mod", "mod", 8, 2, 0, ErrUnknownOperation},
		{"unknown/empty", "", 8, 2, 0, ErrUnknownOperation},
		{"unknown/whitespace-only", "   ", 8, 2, 0, ErrUnknownOperation},
		{"unknown/alias-plus", "plus", 2, 3, 0, ErrUnknownOperation},

		{"divide-by-zero/positive-numerator", "divide", 5, 0, 0, ErrDivideByZero},
		{"divide-by-zero/zero-numerator", "divide", 0, 0, 0, ErrDivideByZero},
		{"divide-by-zero/negative-numerator", "divide", -5, 0, 0, ErrDivideByZero},
		{"divide-by-zero/negzero/positive-numerator", "divide", 5, negZero, 0, ErrDivideByZero},
		{"divide-by-zero/negzero/zero-numerator", "divide", 0, negZero, 0, ErrDivideByZero},
		{"divide-by-zero/negzero/negative-numerator", "divide", -5, negZero, 0, ErrDivideByZero},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Evaluate(tc.op, tc.a, tc.b)

			require.ErrorIs(t, err, tc.wantErr)
			require.Equal(t, tc.want, got)
		})
	}
}

func TestEvaluateConcurrent(t *testing.T) {
	negZero := math.Copysign(0, -1)

	inputs := []struct {
		op      string
		a, b    float64
		want    float64
		wantErr error
	}{
		{"add", 2, 3, 5, nil},
		{" subtract ", 2, 3, -1, nil},
		{"MuLtIpLy", 3, 4, 12, nil},
		{"divide", 8, 2, 4, nil},
		{"divide", 5, 0, 0, ErrDivideByZero},
		{"divide", 5, negZero, 0, ErrDivideByZero},
		{"mod", 8, 2, 0, ErrUnknownOperation},
	}

	const (
		goroutines = 8
		iterations = 100
	)

	var wg sync.WaitGroup
	wg.Add(goroutines)

	for range goroutines {
		go func() {
			defer wg.Done()

			for range iterations {
				for _, in := range inputs {
					got, err := Evaluate(in.op, in.a, in.b)

					assert.ErrorIs(t, err, in.wantErr)
					assert.Equal(t, in.want, got)
				}
			}
		}()
	}

	wg.Wait()
}
