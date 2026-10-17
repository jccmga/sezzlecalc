// Command server runs the calculator HTTP service on :8080.
package main

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"time"

	"sezzlecalc/backend/internal/httpapi"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	handler := httpapi.NewHandler(logger)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	logger.Info("calculator server listening", "addr", srv.Addr)

	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("server failed", "error", err)
		os.Exit(1)
	}
}
