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

type DatastoreConfig struct {
	Endpoint      string // e.g. http://datastore.hanzo.svc:8080/api/v1/ingest
	APIKey        string
	BatchSize     int
	FlushInterval time.Duration
	Timeout       time.Duration
}

type DatastoreEvent struct {
	Event          string                 `json:"event"`
	DistinctID     string                 `json:"distinct_id"`
	OrganizationID string                 `json:"organization_id,omitempty"`
	SessionID      string                 `json:"session_id,omitempty"`
	Properties     map[string]interface{} `json:"properties,omitempty"`
	Timestamp      time.Time              `json:"timestamp"`
	SentAt         time.Time              `json:"sent_at,omitempty"`
	Lib            string                 `json:"lib,omitempty"`
}

type DatastoreClient struct {
	config     *DatastoreConfig
	httpClient *http.Client
	eventQueue chan *DatastoreEvent
	wg         sync.WaitGroup
	closed     bool
	mu         sync.RWMutex
}

func NewDatastoreClient(config *DatastoreConfig) *DatastoreClient {
	if config.BatchSize == 0 {
		config.BatchSize = 100
	}
	if config.FlushInterval == 0 {
		config.FlushInterval = 10 * time.Second
	}
	if config.Timeout == 0 {
		config.Timeout = 10 * time.Second
	}

	c := &DatastoreClient{
		config:     config,
		httpClient: &http.Client{Timeout: config.Timeout},
		eventQueue: make(chan *DatastoreEvent, config.BatchSize*10),
	}

	c.wg.Add(1)
	go c.processBatch()
	return c
}

// Send queues an event, falling back to synchronous send if the queue is full or closed.
func (c *DatastoreClient) Send(event *DatastoreEvent) error {
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
		return c.sendEvents([]*DatastoreEvent{event})
	}

	select {
	case c.eventQueue <- event:
		return nil
	default:
		return c.sendEvents([]*DatastoreEvent{event})
	}
}

func (c *DatastoreClient) sendEvents(events []*DatastoreEvent) error {
	if len(events) == 0 {
		return nil
	}

	body, err := json.Marshal(events)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, c.config.Endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.config.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("datastore API error: status %d", resp.StatusCode)
	}
	return nil
}

func (c *DatastoreClient) processBatch() {
	defer c.wg.Done()

	batch := make([]*DatastoreEvent, 0, c.config.BatchSize)
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

func (c *DatastoreClient) Flush() error {
	batch := make([]*DatastoreEvent, 0, c.config.BatchSize)
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

func (c *DatastoreClient) Close() error {
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
