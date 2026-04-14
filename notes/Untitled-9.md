<h1>Healthcare EDA: Registry + Fan-Out + Benchmark Scenarios</h1><h2>Architecture</h2><pre><code class="language-mermaid">flowchart TB
    subgraph python [Python Process]
        Config["BrokerConfig (topics, clients, subscriptions)"]
        Runtime["Runtime mutations: broker_create_topic(), broker_subscribe(), ..."]
    end

    subgraph registry [eda_registry.rs - In-Memory, Protocol Agnostic]
        DashMaps["DashMap: name&lt;-&gt;ID, topic-&gt;subscribers"]
        Validate["validate_name() - ASCII enforcement"]
        Fanout["publish_fanout(topic_id) -&gt; queue stream keys"]
        Resolve["resolve_topic/client(name) -&gt; ID"]
    end

    subgraph protocols [Protocol Layer]
        HTTP["HTTP/REST (actix)"]
        WS["WebSocket (future)"]
        Kafka["Kafka protocol (future)"]
        Redis["Redis protocol (future)"]
    end

    subgraph streams [Stream Storage]
        QueueStreams["streams/zt.X.zc.Y/ (one per topic-subscriber pair)"]
    end

    Config --&gt;|"startup"| DashMaps
    Runtime --&gt;|"runtime mutations"| DashMaps
    HTTP --&gt; Resolve
    HTTP --&gt; Fanout
    WS --&gt; Resolve
    Kafka --&gt; Resolve
    Resolve --&gt; DashMaps
    Fanout --&gt; DashMaps
    Fanout --&gt; QueueStreams</code></pre><h2>Phase 0: Rename <code>fs_*</code> to <code>broker_*</code></h2><p>Every <code>#[pyfunction]</code> currently named <code>fs_*</code> gets renamed to <code>broker_*</code>. This is a mechanical rename across:</p><ul><li><p>All <code>#[pyfunction]</code> declarations in Rust (<code>lib.rs</code>, <code>http_server.rs</code>, <code>delivery.rs</code>, <code>eda.rs</code>, <code>eda_dispatch.rs</code>, <code>snowflake.rs</code>, <code>admin.rs</code>, <code>admin_backup.rs</code>, <code>kv.rs</code>, <code>lists.rs</code>, <code>sets.rs</code>, <code>streams.rs</code>, <code>composite.rs</code>, <code>search.rs</code>)</p></li><li><p>All <code>wrap_pyfunction!</code> registrations in <code>lib.rs</code></p></li><li><p>All Python callers (<code>run_server.py</code>, <code>perf_runner.py</code>, <code>api.py</code>, all test files)</p></li></ul><h2>Phase 1: <code>eda_registry.rs</code> — in-memory, protocol-agnostic registry</h2><p>New file: eda_registry.rs</p><p><strong>No disk persistence.</strong> The registry lives entirely in memory. Python populates it at startup via <code>BrokerConfig</code> and mutates it at runtime via <code>broker_*</code> calls. The broker does not care where the data came from.</p><h3>Name validation</h3><pre><code class="language-rust">pub fn validate_name(name: &amp;str) -&gt; Result&lt;(), RegistryError&gt;</code></pre><ul><li><p>Non-empty, max 256 bytes</p></li><li><p>ASCII only: <code>a-z A-Z 0-9 _ - .</code> (no spaces, no slashes, no control chars)</p></li><li><p>Called by every function that accepts a name</p></li></ul><h3>In-memory state</h3><pre><code class="language-rust">pub struct EdaRegistry {
    topic_name_to_id: DashMap&lt;String, String&gt;,
    topic_id_to_name: DashMap&lt;String, String&gt;,
    client_name_to_id: DashMap&lt;String, String&gt;,
    client_id_to_name: DashMap&lt;String, String&gt;,
    topic_subscribers: DashMap&lt;String, Vec&lt;String&gt;&gt;,  // topic_id -&gt; [client_id, ...]
    client_subscriptions: DashMap&lt;String, Vec&lt;String&gt;&gt;, // client_id -&gt; [topic_id, ...]
}</code></pre><h3>Core Rust API</h3><pre><code class="language-rust">impl EdaRegistry {
    pub fn new() -&gt; Self
    pub fn create_topic(&amp;self, name: &amp;str) -&gt; Result&lt;String, RegistryError&gt;
    pub fn create_client(&amp;self, name: &amp;str) -&gt; Result&lt;String, RegistryError&gt;
    pub fn edit_topic(&amp;self, topic_id: &amp;str, new_name: &amp;str) -&gt; Result&lt;(), RegistryError&gt;
    pub fn edit_client(&amp;self, client_id: &amp;str, new_name: &amp;str) -&gt; Result&lt;(), RegistryError&gt;
    pub fn delete_topic(&amp;self, name: &amp;str) -&gt; Result&lt;(), RegistryError&gt;
    pub fn delete_client(&amp;self, name: &amp;str) -&gt; Result&lt;(), RegistryError&gt;
    pub fn resolve_topic(&amp;self, name: &amp;str) -&gt; Result&lt;String, RegistryError&gt;
    pub fn resolve_client(&amp;self, name: &amp;str) -&gt; Result&lt;String, RegistryError&gt;
    pub fn subscribe(&amp;self, topic_name: &amp;str, client_name: &amp;str) -&gt; Result&lt;String, RegistryError&gt;
    pub fn unsubscribe(&amp;self, topic_name: &amp;str, client_name: &amp;str) -&gt; Result&lt;(), RegistryError&gt;
    pub fn publish_fanout(&amp;self, topic_id: &amp;str) -&gt; Vec&lt;String&gt;  // -&gt; ["zt.X.zc.A", ...]
    pub fn queue_keys(&amp;self, client_id: &amp;str) -&gt; Vec&lt;(String, String)&gt;  // -&gt; [(topic_id, stream_key), ...]
    fn queue_stream_key(topic_id: &amp;str, client_id: &amp;str) -&gt; String  // "zt.X.zc.Y"
}</code></pre><h3>Python-exposed functions (all <code>broker_*</code>)</h3><pre><code class="language-python">broker_create_topic(cfg, name)           -&gt; topic_id
broker_create_client(cfg, name)          -&gt; client_id
broker_edit_topic(cfg, topic_id, name=None, ...)   # future-proof for more fields
broker_edit_client(cfg, client_id, name=None, ...)
broker_delete_topic(cfg, name)
broker_delete_client(cfg, name)
broker_subscribe(cfg, topic_name, client_name)     -&gt; queue_stream_key
broker_unsubscribe(cfg, topic_name, client_name)
broker_publish_fanout(cfg, topic_name)   -&gt; list[str]  # queue stream keys
broker_queue_keys(cfg, client_name)      -&gt; list[tuple[str, str]]</code></pre><h3>Where the registry lives</h3><p>The <code>EdaRegistry</code> is stored as a global <code>Arc&lt;EdaRegistry&gt;</code> (like the existing <code>SHUTDOWN_TX</code> pattern). Initialized during <code>broker_init</code> (currently <code>fs_init</code>). The HTTP server's <code>AppState</code> gets a reference to it.</p><h2>Phase 2: Extend <code>BrokerConfig</code></h2><p><code>BrokerConfig</code> gets new optional fields for initial EDA state:</p><pre><code class="language-rust">pub struct BrokerConfig {
    // ... existing fields ...
    pub topics: Vec&lt;TopicDef&gt;,          // [{name: "ADT"}, {name: "lab_results"}, ...]
    pub clients: Vec&lt;ClientDef&gt;,        // [{name: "billing"}, {name: "pharmacy"}, ...]
    pub subscriptions: Vec&lt;SubDef&gt;,     // [{topic: "ADT", client: "billing"}, ...]
}</code></pre><p>On <code>broker_init</code>, the registry is populated from these lists. Python builds the config from its own database/ODB before starting the broker.</p><h2>Phase 3: Wire into HTTP handlers</h2><p>HTTP handlers become thin wrappers that resolve names via the registry:</p><ul><li><p><code>POST /pubsub/topic/{topic_name}</code> — <code>registry.resolve_topic(name)</code> then <code>registry.publish_fanout(id)</code> then N <code>ShardOp::Publish</code> to queue streams</p></li><li><p><code>POST /pubsub/subscribe</code> — <code>registry.subscribe(topic_name, client_name)</code> then <code>ShardOp::Subscribe</code> on the queue stream</p></li><li><p><code>POST /pubsub/messages/get</code> — <code>registry.resolve_client(name)</code> then <code>registry.queue_keys(id)</code> then read from each queue stream</p></li><li><p><code>POST /pubsub/unsubscribe</code> — <code>registry.unsubscribe(topic_name, client_name)</code> then <code>ShardOp::Unsubscribe</code></p></li></ul><p><code>AppState</code> gets <code>registry: Arc&lt;EdaRegistry&gt;</code>.</p><h2>Phase 4: Benchmark scenarios</h2><h3>Per-scenario broker restart</h3><p>Each scenario <strong>stops the broker, starts a fresh one</strong> with a scenario-specific <code>BrokerConfig</code> containing the right topics, clients, and subscriptions. This ensures clean state and realistic startup.</p><h3>CLI</h3><pre><code class="language-plaintext">make broker-perf-tests scenario=health1
make broker-perf-tests scenario=health-all
make broker-perf-tests scenario=all</code></pre><h3>Scenario flow (each one)</h3><ol><li><p>Build <code>BrokerConfig</code> with topics, clients, subscriptions for this scenario</p></li><li><p>Start broker (auto-populates registry from config)</p></li><li><p>Publish messages via HTTP coroutines (each = independent TCP connection, no pooling)</p></li><li><p>Consume messages via HTTP coroutines</p></li><li><p>Stop broker, report timings</p></li></ol><h3>6 healthcare scenarios</h3><ul><li><p><strong>health1</strong> — Community hospital ADT: 1 topic, 10 subs, 10K msgs at 1.2 KB = 100K queue writes</p></li><li><p><strong>health2</strong> — Multi-hospital IDN labs: 13 topics, 5 subs each, 1K msgs/topic at 5 KB = 65K queue writes</p></li><li><p><strong>health3</strong> — Regional HIE ADT: 1 topic, 50 publishers, 6 subs, 50K msgs at 2 KB = 300K queue writes</p></li><li><p><strong>health4</strong> — PACS/DICOM: 1 topic, 3 subs, 500 msgs at 128 KB + 50 msgs at 5 MB</p></li><li><p><strong>health5</strong> — Epic-scale backbone: 8 topics, 5 subs each, mixed sizes, 16K publishes = 80K queue writes</p></li><li><p><strong>health6</strong> — NHS Spine peak: 16 topics, 8 subs each, 50K msgs at 1.5 KB = 400K queue writes</p></li></ul><p></p>