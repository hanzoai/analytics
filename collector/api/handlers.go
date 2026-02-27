package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	collector "github.com/hanzoai/analytics/collector"
	"github.com/hanzoai/analytics/collector/writer"
)

// Handler handles analytics event collection.
type Handler struct {
	writer *writer.Writer
}

// NewHandler creates a new analytics handler.
func NewHandler(w *writer.Writer) *Handler {
	return &Handler{writer: w}
}

// Route sets up analytics routes.
func (h *Handler) Route(r *gin.RouterGroup) {
	r.POST("/event", h.handleEvent)
	r.POST("/events", h.handleBatch)
	r.POST("/pageview", h.handlePageView)
	r.POST("/identify", h.handleIdentify)
	r.POST("/ast", h.handleAST)
	r.POST("/element", h.handleElement)
	r.POST("/section", h.handleSection)
	r.GET("/pixel.gif", h.handlePixel)
	r.POST("/ai/message", h.handleAIMessage)
	r.POST("/ai/completion", h.handleAICompletion)
}

// EventRequest is the standard event request format.
type EventRequest struct {
	Event           string                 `json:"event" binding:"required"`
	DistinctID      string                 `json:"distinct_id"`
	Timestamp       string                 `json:"timestamp"`
	OrganizationID  string                 `json:"organization_id"`
	ProjectID       string                 `json:"project_id"`
	SessionID       string                 `json:"session_id"`
	VisitID         string                 `json:"visit_id"`
	Properties      map[string]interface{} `json:"properties"`
	URL             string                 `json:"url"`
	Referrer        string                 `json:"referrer"`
	Context         string                 `json:"@context"`
	Type            string                 `json:"@type"`
	ElementID       string                 `json:"element_id"`
	ElementType     string                 `json:"element_type"`
	ElementSelector string                 `json:"element_selector"`
	ElementText     string                 `json:"element_text"`
	ElementHref     string                 `json:"element_href"`
	SectionName     string                 `json:"section_name"`
	SectionType     string                 `json:"section_type"`
	SectionID       string                 `json:"section_id"`
	PageTitle       string                 `json:"page_title"`
	PageDescription string                 `json:"page_description"`
	PageType        string                 `json:"page_type"`
	ComponentPath   string                 `json:"component_path"`
	ComponentData   string                 `json:"component_data"`
	ModelProvider   string                 `json:"model_provider"`
	ModelName       string                 `json:"model_name"`
	TokenCount      int                    `json:"token_count"`
	TokenPrice      float64                `json:"token_price"`
	PromptTokens    int                    `json:"prompt_tokens"`
	OutputTokens    int                    `json:"output_tokens"`
	OrderID         string                 `json:"order_id"`
	ProductID       string                 `json:"product_id"`
	CartID          string                 `json:"cart_id"`
	Revenue         float64                `json:"revenue"`
	Quantity        int                    `json:"quantity"`
}

func (h *Handler) handleEvent(c *gin.Context) {
	var req EventRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	event := h.buildRawEvent(c, &req)
	if err := h.writer.Write(event); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to emit event"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h *Handler) handleBatch(c *gin.Context) {
	var req struct {
		Events []EventRequest `json:"events" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	for _, eventReq := range req.Events {
		event := h.buildRawEvent(c, &eventReq)
		h.writer.Write(event)
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "count": len(req.Events)})
}

func (h *Handler) handlePageView(c *gin.Context) {
	var req EventRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	req.Event = "$pageview"
	event := h.buildRawEvent(c, &req)
	if err := h.writer.Write(event); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to emit event"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h *Handler) handleIdentify(c *gin.Context) {
	var req struct {
		DistinctID       string                 `json:"distinct_id" binding:"required"`
		OrganizationID   string                 `json:"organization_id"`
		PersonProperties map[string]interface{} `json:"person_properties"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	orgID := h.resolveOrg(c, req.OrganizationID)

	event := &collector.RawEvent{
		Event:            "$identify",
		DistinctID:       req.DistinctID,
		OrganizationID:   orgID,
		PersonProperties: req.PersonProperties,
		IP:               c.ClientIP(),
		UserAgent:        c.Request.UserAgent(),
		Timestamp:        time.Now(),
		SentAt:           time.Now(),
		Lib:              "hanzo-analytics",
	}

	if err := h.writer.Write(event); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to emit event"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// ASTRequest is the astley.js page AST request format.
type ASTRequest struct {
	Context  string `json:"@context"`
	Type     string `json:"@type"`
	Head     struct {
		Title       string `json:"title"`
		Description string `json:"description"`
	} `json:"head"`
	Sections []struct {
		Name    string `json:"name"`
		Type    string `json:"type"`
		ID      string `json:"id"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
			Href string `json:"href"`
		} `json:"content"`
	} `json:"sections"`
	DistinctID     string `json:"distinct_id"`
	OrganizationID string `json:"organization_id"`
	SessionID      string `json:"session_id"`
	URL            string `json:"url"`
}

func (h *Handler) handleAST(c *gin.Context) {
	var req ASTRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	orgID := h.resolveOrg(c, req.OrganizationID)

	pageEvent := &collector.RawEvent{
		Event:           "$pageview",
		DistinctID:      req.DistinctID,
		OrganizationID:  orgID,
		SessionID:       req.SessionID,
		URL:             req.URL,
		ASTContext:      req.Context,
		ASTType:         req.Type,
		PageTitle:       req.Head.Title,
		PageDescription: req.Head.Description,
		IP:              c.ClientIP(),
		UserAgent:       c.Request.UserAgent(),
		Timestamp:       time.Now(),
		SentAt:          time.Now(),
		Lib:             "astley.js",
	}

	if parsedURL, err := url.Parse(req.URL); err == nil {
		pageEvent.URLPath = parsedURL.Path
		pageEvent.Hostname = parsedURL.Host
	}

	h.writer.Write(pageEvent)

	for _, section := range req.Sections {
		sectionEvent := &collector.RawEvent{
			Event:          "section_viewed",
			DistinctID:     req.DistinctID,
			OrganizationID: orgID,
			SessionID:      req.SessionID,
			URL:            req.URL,
			ASTContext:     req.Context,
			SectionName:    section.Name,
			SectionType:    section.Type,
			SectionID:      section.ID,
			IP:             c.ClientIP(),
			UserAgent:      c.Request.UserAgent(),
			Timestamp:      time.Now(),
			SentAt:         time.Now(),
			Lib:            "astley.js",
		}
		if contentJSON, err := json.Marshal(section.Content); err == nil {
			sectionEvent.ComponentData = string(contentJSON)
		}
		h.writer.Write(sectionEvent)
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok", "sections": len(req.Sections)})
}

func (h *Handler) handleElement(c *gin.Context) {
	var req EventRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Event == "" {
		switch req.ElementType {
		case "button":
			req.Event = "button_clicked"
		case "link":
			req.Event = "link_clicked"
		case "form":
			req.Event = "form_submitted"
		case "input":
			req.Event = "input_changed"
		default:
			req.Event = "element_interaction"
		}
	}

	event := h.buildRawEvent(c, &req)
	event.Lib = "astley.js"

	if err := h.writer.Write(event); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to emit event"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h *Handler) handleSection(c *gin.Context) {
	var req EventRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Event == "" {
		req.Event = "section_viewed"
	}

	event := h.buildRawEvent(c, &req)
	event.Lib = "astley.js"

	if err := h.writer.Write(event); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to emit event"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h *Handler) handlePixel(c *gin.Context) {
	orgID := c.Query("oid")
	if orgVal, exists := c.Get("organization_id"); exists {
		if s, ok := orgVal.(string); ok && s != "" {
			orgID = s
		}
	}

	event := &collector.RawEvent{
		Event:          "pixel_view",
		DistinctID:     c.Query("uid"),
		OrganizationID: orgID,
		SessionID:      c.Query("sid"),
		Properties: map[string]interface{}{
			"source":      c.Query("src"),
			"campaign_id": c.Query("cid"),
			"email_id":    c.Query("eid"),
		},
		IP:        c.ClientIP(),
		UserAgent: c.Request.UserAgent(),
		Referrer:  c.Request.Referer(),
		Timestamp: time.Now(),
		SentAt:    time.Now(),
		Lib:       "hanzo-pixel",
	}

	h.writer.Write(event)

	c.Header("Content-Type", "image/gif")
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Data(http.StatusOK, "image/gif", transparentGIF)
}

func (h *Handler) handleAIMessage(c *gin.Context) {
	var req struct {
		DistinctID     string                 `json:"distinct_id" binding:"required"`
		OrganizationID string                 `json:"organization_id"`
		ChatID         string                 `json:"chat_id"`
		MessageID      string                 `json:"message_id"`
		Role           string                 `json:"role"`
		ModelProvider  string                 `json:"model_provider"`
		ModelName      string                 `json:"model_name"`
		TokenCount     int                    `json:"token_count"`
		PromptTokens   int                    `json:"prompt_tokens"`
		OutputTokens   int                    `json:"output_tokens"`
		TokenPrice     float64                `json:"token_price"`
		Properties     map[string]interface{} `json:"properties"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	orgID := h.resolveOrg(c, req.OrganizationID)

	event := &collector.RawEvent{
		Event:          "ai.message.created",
		DistinctID:     req.DistinctID,
		OrganizationID: orgID,
		SessionID:      req.ChatID,
		Properties:     req.Properties,
		ModelProvider:  req.ModelProvider,
		ModelName:      req.ModelName,
		TokenCount:     req.TokenCount,
		PromptTokens:   req.PromptTokens,
		OutputTokens:   req.OutputTokens,
		TokenPrice:     req.TokenPrice,
		IP:             c.ClientIP(),
		UserAgent:      c.Request.UserAgent(),
		Timestamp:      time.Now(),
		SentAt:         time.Now(),
		Lib:            "hanzo-cloud",
	}

	if event.Properties == nil {
		event.Properties = make(map[string]interface{})
	}
	event.Properties["role"] = req.Role
	event.Properties["message_id"] = req.MessageID

	if err := h.writer.Write(event); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to emit event"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h *Handler) handleAICompletion(c *gin.Context) {
	var req struct {
		DistinctID     string  `json:"distinct_id" binding:"required"`
		OrganizationID string  `json:"organization_id"`
		ChatID         string  `json:"chat_id"`
		ModelProvider  string  `json:"model_provider"`
		ModelName      string  `json:"model_name"`
		PromptTokens   int     `json:"prompt_tokens"`
		OutputTokens   int     `json:"output_tokens"`
		TotalTokens    int     `json:"total_tokens"`
		Price          float64 `json:"price"`
		DurationMs     int64   `json:"duration_ms"`
		Success        bool    `json:"success"`
		ErrorMessage   string  `json:"error_message,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	orgID := h.resolveOrg(c, req.OrganizationID)

	event := &collector.RawEvent{
		Event:          "ai.completion",
		DistinctID:     req.DistinctID,
		OrganizationID: orgID,
		SessionID:      req.ChatID,
		ModelProvider:  req.ModelProvider,
		ModelName:      req.ModelName,
		PromptTokens:   req.PromptTokens,
		OutputTokens:   req.OutputTokens,
		TokenCount:     req.TotalTokens,
		TokenPrice:     req.Price,
		Properties: map[string]interface{}{
			"duration_ms":   req.DurationMs,
			"success":       req.Success,
			"error_message": req.ErrorMessage,
		},
		IP:        c.ClientIP(),
		UserAgent: c.Request.UserAgent(),
		Timestamp: time.Now(),
		SentAt:    time.Now(),
		Lib:       "hanzo-cloud",
	}

	if err := h.writer.Write(event); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to emit event"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// resolveOrg returns the authenticated org ID if available, otherwise the request org ID.
func (h *Handler) resolveOrg(c *gin.Context, requestOrgID string) string {
	if orgVal, exists := c.Get("organization_id"); exists {
		if s, ok := orgVal.(string); ok && s != "" {
			return s
		}
	}
	return requestOrgID
}

func (h *Handler) buildRawEvent(c *gin.Context, req *EventRequest) *collector.RawEvent {
	orgID := h.resolveOrg(c, req.OrganizationID)

	event := &collector.RawEvent{
		Event:           req.Event,
		DistinctID:      req.DistinctID,
		OrganizationID:  orgID,
		ProjectID:       req.ProjectID,
		SessionID:       req.SessionID,
		VisitID:         req.VisitID,
		Properties:      req.Properties,
		URL:             req.URL,
		Referrer:        req.Referrer,
		ASTContext:      req.Context,
		ASTType:         req.Type,
		PageTitle:       req.PageTitle,
		PageDescription: req.PageDescription,
		PageType:        req.PageType,
		ElementID:       req.ElementID,
		ElementType:     req.ElementType,
		ElementSelector: req.ElementSelector,
		ElementText:     req.ElementText,
		ElementHref:     req.ElementHref,
		SectionName:     req.SectionName,
		SectionType:     req.SectionType,
		SectionID:       req.SectionID,
		ComponentPath:   req.ComponentPath,
		ComponentData:   req.ComponentData,
		ModelProvider:   req.ModelProvider,
		ModelName:       req.ModelName,
		TokenCount:      req.TokenCount,
		TokenPrice:      req.TokenPrice,
		PromptTokens:    req.PromptTokens,
		OutputTokens:    req.OutputTokens,
		OrderID:         req.OrderID,
		ProductID:       req.ProductID,
		CartID:          req.CartID,
		Revenue:         req.Revenue,
		Quantity:        req.Quantity,
		IP:              c.ClientIP(),
		UserAgent:       c.Request.UserAgent(),
		Timestamp:       time.Now(),
		SentAt:          time.Now(),
		Lib:             "hanzo-analytics",
	}

	if req.Timestamp != "" {
		if t, err := time.Parse(time.RFC3339, req.Timestamp); err == nil {
			event.Timestamp = t
		}
	}

	if req.URL != "" {
		if parsedURL, err := url.Parse(req.URL); err == nil {
			event.URLPath = parsedURL.Path
			event.Hostname = parsedURL.Host
			query := parsedURL.Query()
			event.UTMSource = query.Get("utm_source")
			event.UTMMedium = query.Get("utm_medium")
			event.UTMCampaign = query.Get("utm_campaign")
			event.UTMContent = query.Get("utm_content")
			event.UTMTerm = query.Get("utm_term")
			event.GCLID = query.Get("gclid")
			event.FBCLID = query.Get("fbclid")
			event.MSCLID = query.Get("msclid")
		}
	}

	if req.Referrer != "" {
		if parsedRef, err := url.Parse(req.Referrer); err == nil {
			event.ReferrerDomain = parsedRef.Host
		}
	}

	if event.DistinctID == "" {
		event.DistinctID = c.ClientIP()
	}

	ua := c.Request.UserAgent()
	event.Browser, event.BrowserVersion = parseUserAgentBrowser(ua)
	event.OS, event.OSVersion = parseUserAgentOS(ua)
	event.DeviceType = parseDeviceType(ua)

	return event
}

func parseUserAgentBrowser(ua string) (string, string) {
	ua = strings.ToLower(ua)
	switch {
	case strings.Contains(ua, "chrome"):
		return "Chrome", ""
	case strings.Contains(ua, "firefox"):
		return "Firefox", ""
	case strings.Contains(ua, "safari"):
		return "Safari", ""
	case strings.Contains(ua, "edge"):
		return "Edge", ""
	case strings.Contains(ua, "opera"):
		return "Opera", ""
	default:
		return "Other", ""
	}
}

func parseUserAgentOS(ua string) (string, string) {
	ua = strings.ToLower(ua)
	switch {
	case strings.Contains(ua, "windows"):
		return "Windows", ""
	case strings.Contains(ua, "mac os"):
		return "macOS", ""
	case strings.Contains(ua, "linux"):
		return "Linux", ""
	case strings.Contains(ua, "android"):
		return "Android", ""
	case strings.Contains(ua, "iphone"), strings.Contains(ua, "ipad"):
		return "iOS", ""
	default:
		return "Other", ""
	}
}

func parseDeviceType(ua string) string {
	ua = strings.ToLower(ua)
	switch {
	case strings.Contains(ua, "mobile"):
		return "mobile"
	case strings.Contains(ua, "tablet"), strings.Contains(ua, "ipad"):
		return "tablet"
	default:
		return "desktop"
	}
}

var transparentGIF = []byte{
	0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
	0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x2c,
	0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02,
	0x02, 0x44, 0x01, 0x00, 0x3b,
}
