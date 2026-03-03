package writer

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	collector "github.com/hanzoai/analytics/collector"
	"github.com/hanzoai/analytics/collector/forward"
)

func TestInsightsForwarder(t *testing.T) {
	var mu sync.Mutex
	var received []map[string]interface{}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var batch []map[string]interface{}
		json.Unmarshal(body, &batch)
		mu.Lock()
		received = append(received, batch...)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	fwd := NewInsightsForwarder(&forward.InsightsConfig{
		Endpoint:      srv.URL,
		APIKey:        "test-key",
		BatchSize:     1,
		FlushInterval: 50 * time.Millisecond,
	})

	event := &collector.RawEvent{
		Event:          "$pageview",
		DistinctID:     "user-1",
		OrganizationID: "org-1",
		SessionID:      "sess-1",
		URL:            "https://example.com/page",
		ASTContext:     "https://schema.org",
		ASTType:        "WebPage",
		PageTitle:      "Test Page",
		SectionName:    "hero",
		Timestamp:      time.Now(),
		SentAt:         time.Now(),
		Lib:            "astley.js",
	}

	fwd.Forward(event)

	// Wait for batch processing.
	time.Sleep(200 * time.Millisecond)
	fwd.Close()

	mu.Lock()
	defer mu.Unlock()

	if len(received) == 0 {
		t.Fatal("expected at least one event forwarded to Insights")
	}

	first := received[0]
	if first["event"] != "$pageview" {
		t.Errorf("expected event=$pageview, got %v", first["event"])
	}
	if first["distinct_id"] != "user-1" {
		t.Errorf("expected distinct_id=user-1, got %v", first["distinct_id"])
	}

	props, ok := first["properties"].(map[string]interface{})
	if !ok {
		t.Fatal("expected properties to be a map")
	}
	if props["ast_context"] != "https://schema.org" {
		t.Errorf("expected ast_context in properties, got %v", props["ast_context"])
	}
	if props["page_title"] != "Test Page" {
		t.Errorf("expected page_title in properties, got %v", props["page_title"])
	}
	if props["organization_id"] != "org-1" {
		t.Errorf("expected organization_id in properties, got %v", props["organization_id"])
	}
}

func TestDatastoreAPIForwarder(t *testing.T) {
	var mu sync.Mutex
	var received []map[string]interface{}
	var authHeader string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		authHeader = r.Header.Get("Authorization")
		mu.Unlock()

		body, _ := io.ReadAll(r.Body)
		var batch []map[string]interface{}
		json.Unmarshal(body, &batch)
		mu.Lock()
		received = append(received, batch...)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	fwd := NewDatastoreAPIForwarder(&forward.DatastoreConfig{
		Endpoint:      srv.URL + "/api/v1/ingest",
		APIKey:        "ds-api-key",
		BatchSize:     1,
		FlushInterval: 50 * time.Millisecond,
	})

	event := &collector.RawEvent{
		Event:           "$pageview",
		DistinctID:      "user-2",
		OrganizationID:  "org-2",
		SessionID:       "sess-2",
		URL:             "https://example.com/ast-page",
		ASTContext:      "https://schema.org",
		ASTType:         "WebPage",
		PageTitle:       "AST Test",
		PageDescription: "Testing AST pipeline",
		SectionName:     "features",
		SectionType:     "section",
		ComponentData:   `[{"type":"a","text":"Click me"}]`,
		Timestamp:       time.Now(),
		SentAt:          time.Now(),
		Lib:             "astley.js",
	}

	fwd.Forward(event)

	time.Sleep(200 * time.Millisecond)
	fwd.Close()

	mu.Lock()
	defer mu.Unlock()

	if authHeader != "Bearer ds-api-key" {
		t.Errorf("expected Authorization header, got %q", authHeader)
	}

	if len(received) == 0 {
		t.Fatal("expected at least one event forwarded to datastore API")
	}

	first := received[0]
	if first["event"] != "$pageview" {
		t.Errorf("expected event=$pageview, got %v", first["event"])
	}
	if first["organization_id"] != "org-2" {
		t.Errorf("expected organization_id=org-2, got %v", first["organization_id"])
	}
	if first["lib"] != "astley.js" {
		t.Errorf("expected lib=astley.js, got %v", first["lib"])
	}

	props, ok := first["properties"].(map[string]interface{})
	if !ok {
		t.Fatal("expected properties to be a map")
	}
	if props["ast_context"] != "https://schema.org" {
		t.Errorf("expected ast_context in properties, got %v", props["ast_context"])
	}
	if props["page_title"] != "AST Test" {
		t.Errorf("expected page_title in properties, got %v", props["page_title"])
	}
	if props["section_name"] != "features" {
		t.Errorf("expected section_name in properties, got %v", props["section_name"])
	}
	if props["component_data"] != `[{"type":"a","text":"Click me"}]` {
		t.Errorf("expected component_data in properties, got %v", props["component_data"])
	}
}

func TestAnalyticsForwarder_PageView(t *testing.T) {
	var mu sync.Mutex
	var received []map[string]interface{}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var payload map[string]interface{}
		json.Unmarshal(body, &payload)
		mu.Lock()
		received = append(received, payload)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	fwd := NewAnalyticsForwarder(&forward.ForwardConfig{
		Endpoint:      srv.URL,
		WebsiteID:     "test-site",
		BatchSize:     1,
		FlushInterval: 50 * time.Millisecond,
	})

	event := &collector.RawEvent{
		Event:     "$pageview",
		URL:       "https://example.com/",
		PageTitle: "Home",
		Referrer:  "https://google.com",
		Hostname:  "example.com",
		Language:  "en",
		Screen:    "1920x1080",
		Timestamp: time.Now(),
	}

	fwd.Forward(event)

	time.Sleep(200 * time.Millisecond)
	fwd.Close()

	mu.Lock()
	defer mu.Unlock()

	if len(received) == 0 {
		t.Fatal("expected at least one event forwarded to analytics")
	}

	first := received[0]
	if first["url"] != "https://example.com/" {
		t.Errorf("expected url, got %v", first["url"])
	}
	if first["website"] != "test-site" {
		t.Errorf("expected website=test-site, got %v", first["website"])
	}
}

// mockForwarder records all forwarded events for testing.
type mockForwarder struct {
	mu     sync.Mutex
	events []*collector.RawEvent
}

func (m *mockForwarder) Forward(event *collector.RawEvent) {
	m.mu.Lock()
	m.events = append(m.events, event)
	m.mu.Unlock()
}

func (m *mockForwarder) Close() error { return nil }

func (m *mockForwarder) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.events)
}

var _ Forwarder = (*mockForwarder)(nil)
