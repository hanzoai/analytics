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

// ForwardConfig holds analytics forwarding configuration.
type ForwardConfig struct {
	Endpoint      string
	WebsiteID     string
	BatchSize     int
	FlushInterval time.Duration
	Timeout       time.Duration
}

// ForwardEvent is the internal event representation.
type ForwardEvent struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

// ForwardClient forwards events to the analytics backend.
type ForwardClient struct {
	config     *ForwardConfig
	httpClient *http.Client
	eventQueue chan *ForwardEvent
	wg         sync.WaitGroup
	closed     bool
	mu         sync.RWMutex
}

// Aliases for backwards compatibility.
type UmamiConfig = ForwardConfig
type UmamiEvent = ForwardEvent
type UmamiClient = ForwardClient

// NewForwardClient creates a new analytics forwarding client.
func NewForwardClient(config *ForwardConfig) *ForwardClient {
	if config.BatchSize == 0 {
		config.BatchSize = 50
	}
	if config.FlushInterval == 0 {
		config.FlushInterval = 10 * time.Second
	}
	if config.Timeout == 0 {
		config.Timeout = 5 * time.Second
	}

	c := &ForwardClient{
		config:     config,
		httpClient: &http.Client{Timeout: config.Timeout},
		eventQueue: make(chan *ForwardEvent, config.BatchSize*10),
	}

	c.wg.Add(1)
	go c.processBatch()
	return c
}

// NewUmamiClient is an alias for NewForwardClient (backwards compatibility).
var NewUmamiClient = NewForwardClient

// TrackPageView sends a page view.
func (c *ForwardClient) TrackPageView(url, title, referrer, hostname, language, screen string) error {
	return c.sendEvent(&ForwardEvent{
		Type: "event",
		Payload: map[string]interface{}{
			"website":  c.config.WebsiteID,
			"url":      url,
			"title":    title,
			"referrer": referrer,
			"hostname": hostname,
			"language": language,
			"screen":   screen,
		},
	})
}

// TrackEvent sends a custom event.
func (c *ForwardClient) TrackEvent(name string, data map[string]interface{}) error {
	return c.sendEvent(&ForwardEvent{
		Type: "event",
		Payload: map[string]interface{}{
			"website": c.config.WebsiteID,
			"name":    name,
			"data":    data,
		},
	})
}

// TrackCommerceEvent sends a commerce event.
func (c *ForwardClient) TrackCommerceEvent(name, orderID string, total float64, props map[string]interface{}) error {
	data := map[string]interface{}{
		"order_id": orderID,
		"total":    total,
	}
	for k, v := range props {
		data[k] = v
	}
	return c.TrackEvent(name, data)
}

func (c *ForwardClient) sendEvent(event *ForwardEvent) error {
	c.mu.RLock()
	closed := c.closed
	c.mu.RUnlock()
	if closed {
		return c.sendEvents([]*ForwardEvent{event})
	}

	select {
	case c.eventQueue <- event:
		return nil
	default:
		return c.sendEvents([]*ForwardEvent{event})
	}
}

func (c *ForwardClient) sendEvents(events []*ForwardEvent) error {
	for _, event := range events {
		body, err := json.Marshal(event.Payload)
		if err != nil {
			return fmt.Errorf("marshal: %w", err)
		}

		req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, c.config.Endpoint+"/api/send", bytes.NewReader(body))
		if err != nil {
			return fmt.Errorf("create request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return fmt.Errorf("send: %w", err)
		}
		resp.Body.Close()

		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
			return fmt.Errorf("analytics API error: status %d", resp.StatusCode)
		}
	}
	return nil
}

func (c *ForwardClient) processBatch() {
	defer c.wg.Done()

	batch := make([]*ForwardEvent, 0, c.config.BatchSize)
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
func (c *ForwardClient) Flush() error {
	batch := make([]*ForwardEvent, 0, c.config.BatchSize)
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
func (c *ForwardClient) Close() error {
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
