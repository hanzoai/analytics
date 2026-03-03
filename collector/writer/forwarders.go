package writer

import (
	"encoding/json"

	collector "github.com/hanzoai/analytics/collector"
	"github.com/hanzoai/analytics/collector/forward"
)

// InsightsForwarder adapts forward.InsightsClient to the Forwarder interface.
type InsightsForwarder struct {
	client *forward.InsightsClient
}

// NewInsightsForwarder creates a forwarder that sends events to Hanzo Insights.
func NewInsightsForwarder(config *forward.InsightsConfig) *InsightsForwarder {
	return &InsightsForwarder{
		client: forward.NewInsightsClient(config),
	}
}

// Forward converts a RawEvent to an InsightsEvent and captures it.
func (f *InsightsForwarder) Forward(event *collector.RawEvent) {
	props := make(map[string]interface{})

	// Copy existing properties.
	for k, v := range event.Properties {
		props[k] = v
	}

	// Add standard fields as properties so they are queryable in Insights.
	if event.OrganizationID != "" {
		props["organization_id"] = event.OrganizationID
	}
	if event.SessionID != "" {
		props["session_id"] = event.SessionID
	}
	if event.URL != "" {
		props["$current_url"] = event.URL
	}
	if event.URLPath != "" {
		props["$pathname"] = event.URLPath
	}
	if event.Referrer != "" {
		props["$referrer"] = event.Referrer
	}
	if event.Browser != "" {
		props["$browser"] = event.Browser
	}
	if event.OS != "" {
		props["$os"] = event.OS
	}
	if event.DeviceType != "" {
		props["$device_type"] = event.DeviceType
	}
	if event.Lib != "" {
		props["$lib"] = event.Lib
	}

	// AST fields.
	if event.ASTContext != "" {
		props["ast_context"] = event.ASTContext
	}
	if event.ASTType != "" {
		props["ast_type"] = event.ASTType
	}
	if event.PageTitle != "" {
		props["page_title"] = event.PageTitle
	}
	if event.SectionName != "" {
		props["section_name"] = event.SectionName
	}
	if event.SectionType != "" {
		props["section_type"] = event.SectionType
	}
	if event.ComponentPath != "" {
		props["component_path"] = event.ComponentPath
	}
	if event.ComponentData != "" {
		props["component_data"] = event.ComponentData
	}

	// Element interaction fields.
	if event.ElementID != "" {
		props["element_id"] = event.ElementID
	}
	if event.ElementType != "" {
		props["element_type"] = event.ElementType
	}
	if event.ElementText != "" {
		props["element_text"] = event.ElementText
	}
	if event.ElementHref != "" {
		props["element_href"] = event.ElementHref
	}

	f.client.Capture(&forward.InsightsEvent{
		Event:      event.Event,
		DistinctID: event.DistinctID,
		Properties: props,
		Timestamp:  event.Timestamp,
		SentAt:     event.SentAt,
	})
}

// Close shuts down the Insights forwarder.
func (f *InsightsForwarder) Close() error {
	return f.client.Close()
}

// DatastoreAPIForwarder adapts forward.DatastoreClient to the Forwarder interface.
type DatastoreAPIForwarder struct {
	client *forward.DatastoreClient
}

// NewDatastoreAPIForwarder creates a forwarder that sends events to the Hanzo datastore REST API.
func NewDatastoreAPIForwarder(config *forward.DatastoreConfig) *DatastoreAPIForwarder {
	return &DatastoreAPIForwarder{
		client: forward.NewDatastoreClient(config),
	}
}

// Forward converts a RawEvent to a DatastoreEvent and sends it.
func (f *DatastoreAPIForwarder) Forward(event *collector.RawEvent) {
	props := make(map[string]interface{})

	// Copy existing properties.
	for k, v := range event.Properties {
		props[k] = v
	}

	// Include all structured fields so the datastore has the full picture.
	setIfNotEmpty(props, "url", event.URL)
	setIfNotEmpty(props, "url_path", event.URLPath)
	setIfNotEmpty(props, "referrer", event.Referrer)
	setIfNotEmpty(props, "hostname", event.Hostname)
	setIfNotEmpty(props, "browser", event.Browser)
	setIfNotEmpty(props, "os", event.OS)
	setIfNotEmpty(props, "device_type", event.DeviceType)
	setIfNotEmpty(props, "ip", event.IP)
	setIfNotEmpty(props, "user_agent", event.UserAgent)
	setIfNotEmpty(props, "country", event.Country)

	// AST fields.
	setIfNotEmpty(props, "ast_context", event.ASTContext)
	setIfNotEmpty(props, "ast_type", event.ASTType)
	setIfNotEmpty(props, "page_title", event.PageTitle)
	setIfNotEmpty(props, "page_description", event.PageDescription)
	setIfNotEmpty(props, "page_type", event.PageType)

	// Element fields.
	setIfNotEmpty(props, "element_id", event.ElementID)
	setIfNotEmpty(props, "element_type", event.ElementType)
	setIfNotEmpty(props, "element_selector", event.ElementSelector)
	setIfNotEmpty(props, "element_text", event.ElementText)
	setIfNotEmpty(props, "element_href", event.ElementHref)

	// Section fields.
	setIfNotEmpty(props, "section_name", event.SectionName)
	setIfNotEmpty(props, "section_type", event.SectionType)
	setIfNotEmpty(props, "section_id", event.SectionID)

	// Component fields.
	setIfNotEmpty(props, "component_path", event.ComponentPath)
	setIfNotEmpty(props, "component_data", event.ComponentData)

	// Commerce fields.
	setIfNotEmpty(props, "order_id", event.OrderID)
	setIfNotEmpty(props, "product_id", event.ProductID)
	if event.Revenue != 0 {
		props["revenue"] = event.Revenue
	}

	// AI fields.
	setIfNotEmpty(props, "model_provider", event.ModelProvider)
	setIfNotEmpty(props, "model_name", event.ModelName)
	if event.TokenCount > 0 {
		props["token_count"] = event.TokenCount
	}
	if event.PromptTokens > 0 {
		props["prompt_tokens"] = event.PromptTokens
	}
	if event.OutputTokens > 0 {
		props["output_tokens"] = event.OutputTokens
	}

	// Person properties as nested object.
	if len(event.PersonProperties) > 0 {
		if b, err := json.Marshal(event.PersonProperties); err == nil {
			props["person_properties"] = string(b)
		}
	}

	f.client.Send(&forward.DatastoreEvent{
		Event:          event.Event,
		DistinctID:     event.DistinctID,
		OrganizationID: event.OrganizationID,
		SessionID:      event.SessionID,
		Properties:     props,
		Timestamp:      event.Timestamp,
		SentAt:         event.SentAt,
		Lib:            event.Lib,
	})
}

// Close shuts down the datastore API forwarder.
func (f *DatastoreAPIForwarder) Close() error {
	return f.client.Close()
}

// AnalyticsForwarder adapts forward.ForwardClient to the Forwarder interface.
type AnalyticsForwarder struct {
	client *forward.ForwardClient
}

// NewAnalyticsForwarder creates a forwarder that sends events to the Hanzo analytics backend (Umami).
func NewAnalyticsForwarder(config *forward.ForwardConfig) *AnalyticsForwarder {
	return &AnalyticsForwarder{
		client: forward.NewForwardClient(config),
	}
}

// Forward converts a RawEvent and sends it to the analytics backend.
func (f *AnalyticsForwarder) Forward(event *collector.RawEvent) {
	switch event.Event {
	case "$pageview":
		f.client.TrackPageView(event.URL, event.PageTitle, event.Referrer, event.Hostname, event.Language, event.Screen)
	default:
		data := make(map[string]interface{})
		for k, v := range event.Properties {
			data[k] = v
		}
		if event.OrganizationID != "" {
			data["organization_id"] = event.OrganizationID
		}
		f.client.TrackEvent(event.Event, data)
	}
}

// Close shuts down the analytics forwarder.
func (f *AnalyticsForwarder) Close() error {
	return f.client.Close()
}

func setIfNotEmpty(m map[string]interface{}, key, val string) {
	if val != "" {
		m[key] = val
	}
}

// compile-time interface assertions
var _ Forwarder = (*InsightsForwarder)(nil)
var _ Forwarder = (*DatastoreAPIForwarder)(nil)
var _ Forwarder = (*AnalyticsForwarder)(nil)
