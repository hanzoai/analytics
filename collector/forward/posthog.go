package forward

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// PostHogConfig holds PostHog forwarding configuration.
type PostHogConfig struct {
	Endpoint      string
	APIKey        string
	BatchSize     int
	FlushInterval time.Duration
	Timeout       time.Duration
}

// PostHogEvent represents an event to forward to PostHog.
type PostHogEvent struct {
	Event      string                 `json:"event"`
	DistinctID string                 `json:"distinct_id"`
	Properties map[string]interface{} `json:"properties,omitempty"`
	Timestamp  time.Time              `json:"timestamp,omitempty"`
	SentAt     time.Time              `json:"sent_at,omitempty"`
}

// PostHogClient forwards events to PostHog/Insights.
type PostHogClient struct {
	config     *PostHogConfig
	httpClient *http.Client
	eventQueue chan *PostHogEvent
	wg         sync.WaitGroup
	closed     bool
	mu         sync.RWMutex
}

// NewPostHogClient creates a new PostHog forwarding client.
func NewPostHogClient(config *PostHogConfig) *PostHogClient {
	if config.BatchSize == 0 {
		config.BatchSize = 100
	}
	if config.FlushInterval == 0 {
		config.FlushInterval = 30 * time.Second
	}
	if config.Timeout == 0 {
		config.Timeout = 10 * time.Second
	}

	c := &PostHogClient{
		config:     config,
		httpClient: &http.Client{Timeout: config.Timeout},
		eventQueue: make(chan *PostHogEvent, config.BatchSize*10),
	}

	c.wg.Add(1)
	go c.processBatch()
	return c
}

// Capture sends an event to PostHog.
func (c *PostHogClient) Capture(event *PostHogEvent) error {
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}
	if event.SentAt.IsZero() {
		event.SentAt = time.Now()
	}

	c.mu.RLock()
	closed := c.closed
	c.mu.RUnlock()
	if closed {
		return c.sendEvents([]*PostHogEvent{event})
	}

	select {
	case c.eventQueue <- event:
		return nil
	default:
		return c.sendEvents([]*PostHogEvent{event})
	}
}

func (c *PostHogClient) sendEvents(events []*PostHogEvent) error {
	if len(events) == 0 {
		return nil
	}

	batch := make([]map[string]interface{}, len(events))
	for i, event := range events {
		batch[i] = map[string]interface{}{
			"api_key":     c.config.APIKey,
			"event":       event.Event,
			"distinct_id": event.DistinctID,
			"properties":  event.Properties,
			"timestamp":   event.Timestamp.Format(time.RFC3339),
			"sent_at":     event.SentAt.Format(time.RFC3339),
		}
	}

	body, err := json.Marshal(batch)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, c.config.Endpoint+"/batch/", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("PostHog API error: status %d", resp.StatusCode)
	}
	return nil
}

func (c *PostHogClient) processBatch() {
	defer c.wg.Done()

	batch := make([]*PostHogEvent, 0, c.config.BatchSize)
	ticker := time.NewTicker(c.config.FlushInterval)
	defer ticker.Stop()

	for {
		select {
		case event, ok := <-c.eventQueue:
			if !ok {
				if len(batch) > 0 {
					c.sendEvents(batch)
				}
				return
			}
			batch = append(batch, event)
			if len(batch) >= c.config.BatchSize {
				c.sendEvents(batch)
				batch = batch[:0]
			}
		case <-ticker.C:
			if len(batch) > 0 {
				c.sendEvents(batch)
				batch = batch[:0]
			}
		}
	}
}

// Flush sends all queued events.
func (c *PostHogClient) Flush() error {
	batch := make([]*PostHogEvent, 0, c.config.BatchSize)
	for {
		select {
		case event := <-c.eventQueue:
			batch = append(batch, event)
		default:
			if len(batch) > 0 {
				return c.sendEvents(batch)
			}
			return nil
		}
	}
}

// Close gracefully shuts down the client.
func (c *PostHogClient) Close() error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil
	}
	c.closed = true
	c.mu.Unlock()

	close(c.eventQueue)
	c.wg.Wait()
	return nil
}
