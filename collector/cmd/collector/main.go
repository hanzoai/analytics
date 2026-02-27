package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/hanzoai/analytics/collector/api"
	"github.com/hanzoai/analytics/collector/writer"
)

func main() {
	addr := getEnv("COLLECTOR_ADDR", ":8091")
	dsn := getEnv("DATASTORE_URL", os.Getenv("DATASTORE_DSN"))

	if dsn == "" {
		fmt.Fprintln(os.Stderr, "DATASTORE_URL or DATASTORE_DSN required")
		os.Exit(1)
	}

	// Initialize datastore writer
	w, err := writer.New(&writer.Config{
		DSN:           dsn,
		BatchSize:     500,
		FlushInterval: 5 * time.Second,
		AsyncInsert:   true,
		BufferSize:    10000,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "Datastore: %v\n", err)
		os.Exit(1)
	}

	// Ensure schema
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	if err := w.EnsureSchema(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: schema: %v\n", err)
	}
	cancel()

	// Setup Gin router
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Analytics endpoints
	handler := api.NewHandler(w)
	handler.Route(r.Group("/"))

	// Start server
	srv := &http.Server{
		Addr:         addr,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		fmt.Printf("analytics-collector starting on %s\n", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "server: %v\n", err)
			os.Exit(1)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	fmt.Println("Shutting down...")
	ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	w.Close()
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
