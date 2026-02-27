package writer

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"

	collector "github.com/hanzoai/analytics/collector"
)

// Config configures the ClickHouse writer.
type Config struct {
	DSN           string
	BatchSize     int
	FlushInterval time.Duration
	AsyncInsert   bool
	BufferSize    int
}

// DefaultConfig returns sensible defaults.
func DefaultConfig() *Config {
	return &Config{
		BatchSize:     500,
		FlushInterval: 5 * time.Second,
		AsyncInsert:   true,
		BufferSize:    10000,
	}
}

// Writer writes events to ClickHouse.
type Writer struct {
	conn    driver.Conn
	config  *Config
	eventCh chan *collector.RawEvent
	wg      sync.WaitGroup
	closed  bool
	mu      sync.RWMutex
}

// New creates a new ClickHouse writer.
func New(config *Config) (*Writer, error) {
	if config == nil {
		config = DefaultConfig()
	}

	opts, err := clickhouse.ParseDSN(config.DSN)
	if err != nil {
		return nil, fmt.Errorf("invalid ClickHouse DSN: %w", err)
	}

	conn, err := clickhouse.Open(opts)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to ClickHouse: %w", err)
	}

	if err := conn.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("ClickHouse ping failed: %w", err)
	}

	w := &Writer{
		conn:    conn,
		config:  config,
		eventCh: make(chan *collector.RawEvent, config.BufferSize),
	}

	w.wg.Add(1)
	go w.processEvents()

	return w, nil
}

// EnsureSchema creates the required tables.
func (w *Writer) EnsureSchema(ctx context.Context) error {
	if err := w.conn.Exec(ctx, `CREATE DATABASE IF NOT EXISTS commerce`); err != nil {
		return fmt.Errorf("create database: %w", err)
	}
	// Schema might already exist, that's OK
	w.conn.Exec(ctx, Schema)
	return nil
}

// Write queues an event for writing.
func (w *Writer) Write(event *collector.RawEvent) error {
	w.mu.RLock()
	if w.closed {
		w.mu.RUnlock()
		return fmt.Errorf("writer is closed")
	}
	w.mu.RUnlock()

	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}
	if event.SentAt.IsZero() {
		event.SentAt = time.Now()
	}
	if event.Lib == "" {
		event.Lib = "hanzo-analytics"
	}

	select {
	case w.eventCh <- event:
		return nil
	default:
		return w.writeBatch([]*collector.RawEvent{event})
	}
}

func (w *Writer) processEvents() {
	defer w.wg.Done()

	batch := make([]*collector.RawEvent, 0, w.config.BatchSize)
	ticker := time.NewTicker(w.config.FlushInterval)
	defer ticker.Stop()

	for {
		select {
		case event, ok := <-w.eventCh:
			if !ok {
				if len(batch) > 0 {
					w.writeBatch(batch)
				}
				return
			}
			batch = append(batch, event)
			if len(batch) >= w.config.BatchSize {
				w.writeBatch(batch)
				batch = batch[:0]
			}
		case <-ticker.C:
			if len(batch) > 0 {
				w.writeBatch(batch)
				batch = batch[:0]
			}
		}
	}
}

func (w *Writer) writeBatch(events []*collector.RawEvent) error {
	if len(events) == 0 {
		return nil
	}

	ctx := context.Background()

	if w.config.AsyncInsert {
		for _, event := range events {
			w.writeEventAsync(ctx, event)
		}
		return nil
	}

	batch, err := w.conn.PrepareBatch(ctx, `INSERT INTO commerce.events`)
	if err != nil {
		return fmt.Errorf("prepare batch: %w", err)
	}

	for _, event := range events {
		propsJSON, _ := json.Marshal(event.Properties)
		personPropsJSON, _ := json.Marshal(event.PersonProperties)
		groupPropsJSON, _ := json.Marshal(event.GroupProperties)

		if err := batch.Append(
			event.DistinctID, event.Event, event.Timestamp, event.SentAt, time.Now(),
			event.OrganizationID, event.ProjectID, event.SessionID, event.VisitID,
			string(propsJSON), string(personPropsJSON),
			event.GroupType, event.GroupKey, string(groupPropsJSON),
			event.URL, event.URLPath, event.Referrer, event.ReferrerDomain, event.Hostname,
			event.Browser, event.BrowserVersion, event.OS, event.OSVersion,
			event.Device, event.DeviceType, event.Screen, event.Language,
			event.Country, event.Region, event.City,
			event.UTMSource, event.UTMMedium, event.UTMCampaign, event.UTMContent, event.UTMTerm,
			event.GCLID, event.FBCLID, event.MSCLID,
			event.IP, event.UserAgent,
			event.OrderID, event.ProductID, event.CartID, event.Revenue, event.Quantity,
			event.ASTContext, event.ASTType, event.PageTitle, event.PageDescription, event.PageType,
			event.ElementID, event.ElementType, event.ElementSelector, event.ElementText, event.ElementHref,
			event.SectionName, event.SectionType, event.SectionID,
			event.ComponentPath, event.ComponentData,
			event.ModelProvider, event.ModelName, event.TokenCount, event.TokenPrice, event.PromptTokens, event.OutputTokens,
			event.Lib, event.LibVersion,
		); err != nil {
			batch.Abort()
			return fmt.Errorf("append to batch: %w", err)
		}
	}

	return batch.Send()
}

func (w *Writer) writeEventAsync(ctx context.Context, event *collector.RawEvent) error {
	propsJSON, _ := json.Marshal(event.Properties)
	personPropsJSON, _ := json.Marshal(event.PersonProperties)
	groupPropsJSON, _ := json.Marshal(event.GroupProperties)

	query := `INSERT INTO commerce.events (
		distinct_id, event, timestamp, sent_at, created_at,
		organization_id, project_id, session_id, visit_id,
		properties, person_properties, group_type, group_key, group_properties,
		url, url_path, referrer, referrer_domain, hostname,
		browser, browser_version, os, os_version, device, device_type, screen, language,
		country, region, city,
		utm_source, utm_medium, utm_campaign, utm_content, utm_term,
		gclid, fbclid, msclid,
		ip, user_agent,
		order_id, product_id, cart_id, revenue, quantity,
		ast_context, ast_type, page_title, page_description, page_type,
		element_id, element_type, element_selector, element_text, element_href,
		section_name, section_type, section_id,
		component_path, component_data,
		model_provider, model_name, token_count, token_price, prompt_tokens, output_tokens,
		lib, lib_version
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	return w.conn.AsyncInsert(ctx, query, false,
		event.DistinctID, event.Event, event.Timestamp, event.SentAt, time.Now(),
		event.OrganizationID, event.ProjectID, event.SessionID, event.VisitID,
		string(propsJSON), string(personPropsJSON),
		event.GroupType, event.GroupKey, string(groupPropsJSON),
		event.URL, event.URLPath, event.Referrer, event.ReferrerDomain, event.Hostname,
		event.Browser, event.BrowserVersion, event.OS, event.OSVersion,
		event.Device, event.DeviceType, event.Screen, event.Language,
		event.Country, event.Region, event.City,
		event.UTMSource, event.UTMMedium, event.UTMCampaign, event.UTMContent, event.UTMTerm,
		event.GCLID, event.FBCLID, event.MSCLID,
		event.IP, event.UserAgent,
		event.OrderID, event.ProductID, event.CartID, event.Revenue, event.Quantity,
		event.ASTContext, event.ASTType, event.PageTitle, event.PageDescription, event.PageType,
		event.ElementID, event.ElementType, event.ElementSelector, event.ElementText, event.ElementHref,
		event.SectionName, event.SectionType, event.SectionID,
		event.ComponentPath, event.ComponentData,
		event.ModelProvider, event.ModelName, event.TokenCount, event.TokenPrice, event.PromptTokens, event.OutputTokens,
		event.Lib, event.LibVersion,
	)
}

// Flush writes all pending events.
func (w *Writer) Flush() error {
	batch := make([]*collector.RawEvent, 0, w.config.BatchSize)
	for {
		select {
		case event := <-w.eventCh:
			batch = append(batch, event)
		default:
			if len(batch) > 0 {
				return w.writeBatch(batch)
			}
			return nil
		}
	}
}

// Close gracefully shuts down the writer.
func (w *Writer) Close() error {
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return nil
	}
	w.closed = true
	w.mu.Unlock()

	close(w.eventCh)
	w.wg.Wait()
	return w.conn.Close()
}
