package calc

import (
	"errors"
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
		notErr  error
	}{
		{"add/positive", "add", 2, 3, 5, nil, nil},
		{"add/negative", "add", -2, -3, -5, nil, nil},
		{"add/fractional", "add", 1.5, 0.25, 1.75, nil, nil},
		{"add/zero", "add", 7, 0, 7, nil, nil},

		{"subtract/positive", "subtract", 2, 3, -1, nil, nil},
		{"subtract/negative", "subtract", -2, -3, 1, nil, nil},
		{"subtract/fractional", "subtract", 0.5, 1.25, -0.75, nil, nil},
		{"subtract/zero", "subtract", 7, 0, 7, nil, nil},

		{"multiply/positive", "multiply", 2, 3, 6, nil, nil},
		{"multiply/mixed-sign", "multiply", -2, 3, -6, nil, nil},
		{"multiply/fractional", "multiply", 1.5, 2, 3, nil, nil},
		{"multiply/zero", "multiply", 7, 0, 0, nil, nil},

		{"divide/positive", "divide", 8, 2, 4, nil, nil},
		{"divide/negative", "divide", -8, 2, -4, nil, nil},
		{"divide/negative-divisor", "divide", 8, -2, -4, nil, nil},
		{"divide/fractional", "divide", 1, 2, 0.5, nil, nil},
		{"divide/zero-numerator", "divide", 0, 5, 0, nil, nil},

		{"power/positive", "power", 2, 10, 1024, nil, nil},
		{"power/negative-exponent", "power", 2, -2, 0.25, nil, nil},
		{"power/fractional-exponent", "power", 4, 0.5, 2, nil, nil},
		{"power/zero-zero", "power", 0, 0, 1, nil, nil},

		{"sqrt/positive", "sqrt", 9, 0, 3, nil, nil},
		{"sqrt/fractional", "sqrt", 2, 0, math.Sqrt(2), nil, nil},
		{"sqrt/zero", "sqrt", 0, 0, 0, nil, nil},
		{"sqrt/ignores-b", "sqrt", 9, 99, 3, nil, nil},

		{"percent/positive", "percent", 50, 0, 0.5, nil, nil},
		{"percent/negative", "percent", -25, 0, -0.25, nil, nil},
		{"percent/zero", "percent", 0, 0, 0, nil, nil},
		{"percent/ignores-b", "percent", 50, 7, 0.5, nil, nil},

		{"normalize/add/mixed-case", "Add", 2, 3, 5, nil, nil},
		{"normalize/add/padded", " add ", 2, 3, 5, nil, nil},
		{"normalize/add/upper", "ADD", 2, 3, 5, nil, nil},
		{"normalize/subtract/padded", " subtract ", 2, 3, -1, nil, nil},
		{"normalize/multiply/mixed-case", "MuLtIpLy", 3, 4, 12, nil, nil},
		{"normalize/divide/padded", "  divide  ", 8, 2, 4, nil, nil},
		{"normalize/power/mixed-case", "PoWeR", 2, 3, 8, nil, nil},
		{"normalize/power/padded", " power ", 2, 3, 8, nil, nil},
		{"normalize/sqrt/upper", "SQRT", 9, 0, 3, nil, nil},
		{"normalize/percent/mixed-case", " PeRcEnT ", 50, 0, 0.5, nil, nil},

		{"unknown/mod", "mod", 8, 2, 0, ErrUnknownOperation, nil},
		{"unknown/empty", "", 8, 2, 0, ErrUnknownOperation, nil},
		{"unknown/whitespace-only", "   ", 8, 2, 0, ErrUnknownOperation, nil},
		{"unknown/alias-plus", "plus", 2, 3, 0, ErrUnknownOperation, nil},

		{"non-finite/power/overflow", "power", 10, 400, 0, ErrNonFiniteResult, nil},
		{"non-finite/power/nan", "power", -2, 0.5, 0, ErrNonFiniteResult, nil},
		{"non-finite/power/zero-negative-exp", "power", 0, -1, 0, ErrNonFiniteResult, ErrDivideByZero},
		{"non-finite/multiply/overflow", "multiply", 1e308, 10, 0, ErrNonFiniteResult, nil},
		{"sqrt/negative", "sqrt", -1, 0, 0, ErrSqrtNegative, nil},

		{"divide-by-zero/positive-numerator", "divide", 5, 0, 0, ErrDivideByZero, nil},
		{"divide-by-zero/zero-numerator", "divide", 0, 0, 0, ErrDivideByZero, nil},
		{"divide-by-zero/negative-numerator", "divide", -5, 0, 0, ErrDivideByZero, nil},
		{"divide-by-zero/negzero/positive-numerator", "divide", 5, negZero, 0, ErrDivideByZero, nil},
		{"divide-by-zero/negzero/zero-numerator", "divide", 0, negZero, 0, ErrDivideByZero, nil},
		{"divide-by-zero/negzero/negative-numerator", "divide", -5, negZero, 0, ErrDivideByZero, nil},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Evaluate(tc.op, tc.a, tc.b)

			require.ErrorIs(t, err, tc.wantErr)
			require.Equal(t, tc.want, got)

			if tc.notErr != nil {
				require.False(t, errors.Is(err, tc.notErr))
			}
		})
	}
}

func TestEvaluateNegativeZero(t *testing.T) {
	negZero := math.Copysign(0, -1)

	cases := []struct {
		name string
		op   string
		a    float64
		want float64
	}{
		{"sqrt/preserves-sign", "sqrt", negZero, negZero},
		{"percent/preserves-sign", "percent", negZero, negZero},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Evaluate(tc.op, tc.a, 0)

			require.NoError(t, err)
			require.Equal(t, tc.want, got)
			require.True(t, math.Signbit(got))
		})
	}
}

func TestArity(t *testing.T) {
	cases := []struct {
		name      string
		op        string
		wantArity int
		wantOK    bool
	}{
		{"add/binary", "add", 2, true},
		{"subtract/binary", "subtract", 2, true},
		{"multiply/binary", "multiply", 2, true},
		{"divide/binary", "divide", 2, true},
		{"power/binary", "power", 2, true},
		{"sqrt/unary", "sqrt", 1, true},
		{"percent/unary", "percent", 1, true},
		{"normalize/sqrt/padded-upper", " SQRT ", 1, true},
		{"normalize/power/mixed-case", "Power", 2, true},
		{"unknown/mod", "mod", 0, false},
		{"unknown/empty", "", 0, false},
		{"unknown/whitespace-only", "   ", 0, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			arity, ok := Arity(tc.op)

			require.Equal(t, tc.wantArity, arity)
			require.Equal(t, tc.wantOK, ok)
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
		{"power", 2, 3, 8, nil},
		{" SQRT ", 9, 0, 3, nil},
		{"percent", 50, 0, 0.5, nil},
		{"power", 10, 400, 0, ErrNonFiniteResult},
		{"sqrt", -1, 0, 0, ErrSqrtNegative},
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
