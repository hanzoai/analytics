package writer

// Schema contains ClickHouse table definitions for unified analytics.
const Schema = `
CREATE TABLE IF NOT EXISTS commerce.events (
    event_id UUID DEFAULT generateUUIDv4(),
    distinct_id String,
    event String,
    timestamp DateTime64(3) DEFAULT now64(3),
    sent_at DateTime64(3) DEFAULT now64(3),
    created_at DateTime64(3) DEFAULT now64(3),
    organization_id String,
    project_id String DEFAULT '',
    session_id String DEFAULT '',
    visit_id String DEFAULT '',
    properties String DEFAULT '{}',
    person_properties String DEFAULT '{}',
    group_type String DEFAULT '',
    group_key String DEFAULT '',
    group_properties String DEFAULT '{}',
    url String DEFAULT '',
    url_path String DEFAULT '',
    referrer String DEFAULT '',
    referrer_domain String DEFAULT '',
    hostname String DEFAULT '',
    browser String DEFAULT '',
    browser_version String DEFAULT '',
    os String DEFAULT '',
    os_version String DEFAULT '',
    device String DEFAULT '',
    device_type LowCardinality(String) DEFAULT '',
    screen String DEFAULT '',
    language String DEFAULT '',
    country LowCardinality(String) DEFAULT '',
    region String DEFAULT '',
    city String DEFAULT '',
    utm_source String DEFAULT '',
    utm_medium String DEFAULT '',
    utm_campaign String DEFAULT '',
    utm_content String DEFAULT '',
    utm_term String DEFAULT '',
    gclid String DEFAULT '',
    fbclid String DEFAULT '',
    msclkid String DEFAULT '',
    ip String DEFAULT '',
    user_agent String DEFAULT '',
    order_id String DEFAULT '',
    product_id String DEFAULT '',
    cart_id String DEFAULT '',
    revenue Decimal64(4) DEFAULT 0,
    quantity UInt32 DEFAULT 0,
    ast_context String DEFAULT '',
    ast_type String DEFAULT '',
    page_title String DEFAULT '',
    page_description String DEFAULT '',
    page_type LowCardinality(String) DEFAULT '',
    element_id String DEFAULT '',
    element_type LowCardinality(String) DEFAULT '',
    element_selector String DEFAULT '',
    element_text String DEFAULT '',
    element_href String DEFAULT '',
    section_name String DEFAULT '',
    section_type LowCardinality(String) DEFAULT '',
    section_id String DEFAULT '',
    component_path String DEFAULT '',
    component_data String DEFAULT '',
    model_provider LowCardinality(String) DEFAULT '',
    model_name String DEFAULT '',
    token_count UInt32 DEFAULT 0,
    token_price Decimal64(6) DEFAULT 0,
    prompt_tokens UInt32 DEFAULT 0,
    output_tokens UInt32 DEFAULT 0,
    lib String DEFAULT 'hanzo-analytics',
    lib_version String DEFAULT '',
    _partition_date Date DEFAULT toDate(timestamp)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(_partition_date)
ORDER BY (organization_id, toStartOfHour(timestamp), distinct_id, session_id, event_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS commerce.events_hourly (
    organization_id String,
    hour DateTime,
    event String,
    url_path String,
    referrer_domain String,
    country LowCardinality(String),
    device_type LowCardinality(String),
    browser String,
    os String,
    event_count UInt64,
    unique_users UInt64,
    unique_sessions UInt64,
    total_revenue Decimal64(4)
)
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (organization_id, hour, event, url_path, referrer_domain, country, device_type, browser, os);

CREATE MATERIALIZED VIEW IF NOT EXISTS commerce.events_hourly_mv
TO commerce.events_hourly
AS SELECT
    organization_id,
    toStartOfHour(timestamp) as hour,
    event,
    url_path,
    referrer_domain,
    country,
    device_type,
    browser,
    os,
    count() as event_count,
    uniqExact(distinct_id) as unique_users,
    uniqExact(session_id) as unique_sessions,
    sum(revenue) as total_revenue
FROM commerce.events
GROUP BY organization_id, hour, event, url_path, referrer_domain, country, device_type, browser, os;

CREATE TABLE IF NOT EXISTS commerce.persons (
    distinct_id String,
    organization_id String,
    properties String DEFAULT '{}',
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3),
    email String DEFAULT '',
    name String DEFAULT '',
    _partition_date Date DEFAULT toDate(created_at)
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(_partition_date)
ORDER BY (organization_id, distinct_id);

CREATE TABLE IF NOT EXISTS commerce.sessions (
    session_id String,
    distinct_id String,
    organization_id String,
    started_at DateTime64(3),
    ended_at DateTime64(3),
    duration_seconds UInt32 DEFAULT 0,
    entry_url String DEFAULT '',
    exit_url String DEFAULT '',
    pageview_count UInt32 DEFAULT 0,
    event_count UInt32 DEFAULT 0,
    is_bounce UInt8 DEFAULT 0,
    browser String DEFAULT '',
    os String DEFAULT '',
    device_type LowCardinality(String) DEFAULT '',
    country LowCardinality(String) DEFAULT '',
    _partition_date Date DEFAULT toDate(started_at)
)
ENGINE = ReplacingMergeTree(ended_at)
PARTITION BY toYYYYMM(_partition_date)
ORDER BY (organization_id, session_id);

CREATE TABLE IF NOT EXISTS commerce.groups (
    group_type String,
    group_key String,
    organization_id String,
    properties String DEFAULT '{}',
    created_at DateTime64(3) DEFAULT now64(3),
    updated_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (organization_id, group_type, group_key);
`
