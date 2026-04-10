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
	"github.com/hanzoai/analytics/collector/forward"
	"github.com/hanzoai/analytics/collector/writer"
)

func main() {
	addr := getEnv("COLLECTOR_ADDR", ":8091")
	dsn := getEnv("DATASTORE_URL", os.Getenv("DATASTORE_DSN"))

	if dsn == "" {
		fmt.Fprintln(os.Stderr, "DATASTORE_URL or DATASTORE_DSN required")
		os.Exit(1)
	}

	// Build forwarders from environment configuration.
	var forwarders []writer.Forwarder

	// Insights forwarder (behavioral analytics / Insights-compatible).
	if endpoint := getEnv("INSIGHTS_HOST", os.Getenv("INSIGHTS_ENDPOINT")); endpoint != "" {
		apiKey := getEnv("INSIGHTS_API_KEY", os.Getenv("INSIGHTS_KEY"))
		if apiKey != "" {
			fmt.Printf("Insights forwarding enabled: %s\n", endpoint)
			forwarders = append(forwarders, writer.NewInsightsForwarder(&forward.InsightsConfig{
				Endpoint: endpoint,
				APIKey:   apiKey,
			}))
		}
	}

	// Datastore REST API forwarder (Hanzo datastore service).
	if endpoint := getEnv("DATASTORE_API_URL", os.Getenv("DATASTORE_API_ENDPOINT")); endpoint != "" {
		apiKey := getEnv("DATASTORE_API_KEY", "")
		fmt.Printf("Datastore API forwarding enabled: %s\n", endpoint)
		forwarders = append(forwarders, writer.NewDatastoreAPIForwarder(&forward.DatastoreConfig{
			Endpoint: endpoint,
			APIKey:   apiKey,
		}))
	}

	// Analytics backend forwarder (Umami-compatible).
	if endpoint := getEnv("ANALYTICS_FORWARD_URL", os.Getenv("ANALYTICS_ENDPOINT")); endpoint != "" {
		websiteID := getEnv("ANALYTICS_WEBSITE_ID", "")
		fmt.Printf("Analytics forwarding enabled: %s\n", endpoint)
		forwarders = append(forwarders, writer.NewAnalyticsForwarder(&forward.ForwardConfig{
			Endpoint:  endpoint,
			WebsiteID: websiteID,
		}))
	}

	// Initialize datastore writer with forwarders.
	w, err := writer.New(&writer.Config{
		DSN:           dsn,
		BatchSize:     500,
		FlushInterval: 5 * time.Second,
		AsyncInsert:   true,
		BufferSize:    10000,
		Forwarders:    forwarders,
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
		c.JSON(http.StatusOK, gin.H{"status": "ok", "forwarders": len(forwarders)})
	})

	// Analytics endpoints
	handler := api.NewHandler(w)
	handler.Route(r.Group("/"))
	handler.Route(r.Group("/v1/analytics"))

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
