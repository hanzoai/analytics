// Package collector provides unified analytics event collection.
package collector

import "time"

// RawEvent is the unified event format written to ClickHouse.
type RawEvent struct {
	// Core identifiers
	DistinctID string `json:"distinct_id"`
	Event      string `json:"event"`

	// Organization
	OrganizationID string `json:"organization_id"`
	ProjectID      string `json:"project_id,omitempty"`

	// Session
	SessionID string `json:"session_id,omitempty"`
	VisitID   string `json:"visit_id,omitempty"`

	// Properties
	Properties       map[string]interface{} `json:"properties,omitempty"`
	PersonProperties map[string]interface{} `json:"person_properties,omitempty"`

	// Group
	GroupType       string                 `json:"group_type,omitempty"`
	GroupKey        string                 `json:"group_key,omitempty"`
	GroupProperties map[string]interface{} `json:"group_properties,omitempty"`

	// Web analytics
	URL            string `json:"url,omitempty"`
	URLPath        string `json:"url_path,omitempty"`
	Referrer       string `json:"referrer,omitempty"`
	ReferrerDomain string `json:"referrer_domain,omitempty"`
	Hostname       string `json:"hostname,omitempty"`

	// Device
	Browser        string `json:"browser,omitempty"`
	BrowserVersion string `json:"browser_version,omitempty"`
	OS             string `json:"os,omitempty"`
	OSVersion      string `json:"os_version,omitempty"`
	Device         string `json:"device,omitempty"`
	DeviceType     string `json:"device_type,omitempty"`
	Screen         string `json:"screen,omitempty"`
	Language       string `json:"language,omitempty"`

	// Geo
	Country string `json:"country,omitempty"`
	Region  string `json:"region,omitempty"`
	City    string `json:"city,omitempty"`

	// UTM
	UTMSource   string `json:"utm_source,omitempty"`
	UTMMedium   string `json:"utm_medium,omitempty"`
	UTMCampaign string `json:"utm_campaign,omitempty"`
	UTMContent  string `json:"utm_content,omitempty"`
	UTMTerm     string `json:"utm_term,omitempty"`

	// Click IDs
	GCLID  string `json:"gclid,omitempty"`
	FBCLID string `json:"fbclid,omitempty"`
	MSCLID string `json:"msclid,omitempty"`

	// Request
	IP        string `json:"ip,omitempty"`
	UserAgent string `json:"user_agent,omitempty"`

	// Commerce
	OrderID   string  `json:"order_id,omitempty"`
	ProductID string  `json:"product_id,omitempty"`
	CartID    string  `json:"cart_id,omitempty"`
	Revenue   float64 `json:"revenue,omitempty"`
	Quantity  int     `json:"quantity,omitempty"`

	// AST/Structured Data (astley.js support)
	ASTContext      string `json:"@context,omitempty"`
	ASTType         string `json:"@type,omitempty"`
	PageTitle       string `json:"page_title,omitempty"`
	PageDescription string `json:"page_description,omitempty"`
	PageType        string `json:"page_type,omitempty"`

	// Element interaction tracking
	ElementID       string `json:"element_id,omitempty"`
	ElementType     string `json:"element_type,omitempty"`
	ElementSelector string `json:"element_selector,omitempty"`
	ElementText     string `json:"element_text,omitempty"`
	ElementHref     string `json:"element_href,omitempty"`

	// Section tracking
	SectionName string `json:"section_name,omitempty"`
	SectionType string `json:"section_type,omitempty"`
	SectionID   string `json:"section_id,omitempty"`

	// Component hierarchy
	ComponentPath string `json:"component_path,omitempty"`
	ComponentData string `json:"component_data,omitempty"`

	// AI/Cloud events
	ModelProvider string  `json:"model_provider,omitempty"`
	ModelName     string  `json:"model_name,omitempty"`
	TokenCount    int     `json:"token_count,omitempty"`
	TokenPrice    float64 `json:"token_price,omitempty"`
	PromptTokens  int     `json:"prompt_tokens,omitempty"`
	OutputTokens  int     `json:"output_tokens,omitempty"`

	// Timestamps
	Timestamp time.Time `json:"timestamp"`
	SentAt    time.Time `json:"sent_at,omitempty"`

	// Library
	Lib        string `json:"lib,omitempty"`
	LibVersion string `json:"lib_version,omitempty"`
}

// StandardEvents defines event names used across the platform.
var StandardEvents = struct {
	PageView           string
	ScreenView         string
	Identify           string
	GroupIdentify      string
	Alias              string
	ProductViewed      string
	ProductAdded       string
	ProductRemoved     string
	CartViewed         string
	CheckoutStarted    string
	CheckoutStep       string
	OrderCompleted     string
	OrderRefunded      string
	SignedUp           string
	SignedIn           string
	SignedOut           string
	FeatureUsed        string
	ButtonClick        string
	FormSubmit         string
	SearchQuery        string
	SectionViewed      string
	ElementInteraction string
	LinkClicked        string
	InputChanged       string
	ScrollDepth        string
	VisibilityChange   string
	AIMessageCreated   string
	AIChatStarted      string
	AICompletion       string
	AITokensConsumed   string
	AIModelInvoked     string
	AIError            string
	PixelView          string
	APIRequest         string
	Exception          string
}{
	PageView:           "$pageview",
	ScreenView:         "$screen",
	Identify:           "$identify",
	GroupIdentify:      "$groupidentify",
	Alias:              "$create_alias",
	ProductViewed:      "product_viewed",
	ProductAdded:       "product_added",
	ProductRemoved:     "product_removed",
	CartViewed:         "cart_viewed",
	CheckoutStarted:    "checkout_started",
	CheckoutStep:       "checkout_step",
	OrderCompleted:     "order_completed",
	OrderRefunded:      "order_refunded",
	SignedUp:           "signed_up",
	SignedIn:           "signed_in",
	SignedOut:          "signed_out",
	FeatureUsed:        "feature_used",
	ButtonClick:        "button_clicked",
	FormSubmit:         "form_submitted",
	SearchQuery:        "search_query",
	SectionViewed:      "section_viewed",
	ElementInteraction: "element_interaction",
	LinkClicked:        "link_clicked",
	InputChanged:       "input_changed",
	ScrollDepth:        "scroll_depth",
	VisibilityChange:   "visibility_change",
	AIMessageCreated:   "ai.message.created",
	AIChatStarted:      "ai.chat.started",
	AICompletion:       "ai.completion",
	AITokensConsumed:   "ai.tokens.consumed",
	AIModelInvoked:     "ai.model.invoked",
	AIError:            "ai.error",
	PixelView:          "pixel_view",
	APIRequest:         "$api_request",
	Exception:          "$exception",
}
