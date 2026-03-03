package forward

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestDatastoreClient_Send(t *testing.T) {
	var mu sync.Mutex
	var received []DatastoreEvent
	var reqAuth string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		reqAuth = r.Header.Get("Authorization")
		mu.Unlock()

		body, _ := io.ReadAll(r.Body)
		var events []DatastoreEvent
		json.Unmarshal(body, &events)
		mu.Lock()
		received = append(received, events...)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	client := NewDatastoreClient(&DatastoreConfig{
		Endpoint:      srv.URL,
		APIKey:        "test-api-key",
		BatchSize:     2,
		FlushInterval: 50 * time.Millisecond,
	})

	// Send two events to trigger batch.
	client.Send(&DatastoreEvent{
		Event:          "ast_page",
		DistinctID:     "u1",
		OrganizationID: "org1",
		Properties:     map[string]interface{}{"ast_type": "WebPage"},
		Timestamp:      time.Now(),
	})
	client.Send(&DatastoreEvent{
		Event:          "section_viewed",
		DistinctID:     "u1",
		OrganizationID: "org1",
		Properties:     map[string]interface{}{"section_name": "hero"},
		Timestamp:      time.Now(),
	})

	time.Sleep(200 * time.Millisecond)
	client.Close()

	mu.Lock()
	defer mu.Unlock()

	if reqAuth != "Bearer test-api-key" {
		t.Errorf("expected auth header, got %q", reqAuth)
	}

	if len(received) < 2 {
		t.Fatalf("expected 2 events, got %d", len(received))
	}

	if received[0].Event != "ast_page" {
		t.Errorf("expected event=ast_page, got %s", received[0].Event)
	}
	if received[1].Event != "section_viewed" {
		t.Errorf("expected event=section_viewed, got %s", received[1].Event)
	}
}

func TestDatastoreClient_FlushOnClose(t *testing.T) {
	var mu sync.Mutex
	var received []DatastoreEvent

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var events []DatastoreEvent
		json.Unmarshal(body, &events)
		mu.Lock()
		received = append(received, events...)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	client := NewDatastoreClient(&DatastoreConfig{
		Endpoint:      srv.URL,
		BatchSize:     100, // Large batch so it won't auto-flush.
		FlushInterval: 10 * time.Second,
	})

	client.Send(&DatastoreEvent{
		Event:      "test_event",
		DistinctID: "u1",
		Timestamp:  time.Now(),
	})

	// Close should flush remaining events.
	client.Close()

	mu.Lock()
	defer mu.Unlock()

	if len(received) != 1 {
		t.Fatalf("expected 1 event flushed on close, got %d", len(received))
	}
}
