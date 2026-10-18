# Makefile — Kahawa Guard demo.
# Recipes are indented with tabs. Versions live in versions.mk.
include versions.mk

CLUSTER     ?= kahawa
PROFILE     ?= naked
PACK        ?= coffee
PROVIDER    ?= mistral
CHART       := deploy/helm/kahawa-guard
TAG         ?= dev
TOOLS_URL   := http://localhost:8000/mcp
WEATHER_URL := http://localhost:8100/mcp
INSPECTOR   := npx @modelcontextprotocol/inspector@$(INSPECTOR_VERSION)
IMAGES      := ui gateway kahawa-tools farm-weather records-fs fake-imds postgres

ver = $(if $(1),--version $(1),)

.DEFAULT_GOAL := help

.PHONY: help prereqs up down cluster platform cilium tetragon kyverno secrets \
	        images load stage deploy naked harden swap reset ui hubble inspector events \
	        ollama mcp-forward mcp-list mcp-tui mcp-test mcp-pin mcp-check \
	        scene1 scene2 scene3 scene3b scene3c scene4 prove-admission redteam

help: ## List targets
	@grep -hE '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*## "}{printf "  %-16s %s\n",$$1,$$2}'

prereqs: ## Check that required tools are installed
	@for t in docker kind kubectl helm cilium hubble npx uv jq; do \
	  command -v $$t >/dev/null || { echo "missing: $$t"; exit 1; }; done
	@echo "all tools found"

up: prereqs cluster platform images load deploy ## Build everything in the naked profile

down: ## Delete the cluster
	kind delete cluster --name $(CLUSTER)

cluster: ## Create the kind cluster without a default CNI or kube-proxy
	kind create cluster --name $(CLUSTER) --config deploy/kind/kind-config.yaml

platform: cilium tetragon kyverno secrets ## Install the platform layer

cilium: ## Install Cilium with Hubble
	helm repo add cilium https://helm.cilium.io >/dev/null 2>&1 || true
	helm repo update >/dev/null
	helm upgrade --install cilium cilium/cilium $(call ver,$(CILIUM_VERSION)) \
	  -n kube-system -f deploy/platform/cilium-values.yaml \
	  --set k8sServiceHost=$(CLUSTER)-control-plane
	cilium status --wait

tetragon: ## Install Tetragon
	helm repo add cilium https://helm.cilium.io >/dev/null 2>&1 || true
	helm upgrade --install tetragon cilium/tetragon $(call ver,$(TETRAGON_VERSION)) \
	  -n kube-system -f deploy/platform/tetragon-values.yaml
	kubectl rollout status -n kube-system ds/tetragon

kyverno: ## Install Kyverno (policies are applied by make harden)
	helm repo add kyverno https://kyverno.github.io/kyverno/ >/dev/null 2>&1 || true
	helm repo update >/dev/null
	helm upgrade --install kyverno kyverno/kyverno $(call ver,$(KYVERNO_VERSION)) \
	  -n kyverno --create-namespace -f deploy/platform/kyverno-values.yaml

secrets: ## Install Vault in dev mode and External Secrets Operator
	helm repo add hashicorp https://helm.releases.hashicorp.com >/dev/null 2>&1 || true
	helm repo add external-secrets https://charts.external-secrets.io >/dev/null 2>&1 || true
	helm repo update >/dev/null
	helm upgrade --install vault hashicorp/vault $(call ver,$(VAULT_VERSION)) \
	  -n vault --create-namespace -f deploy/platform/vault-values.yaml
	helm upgrade --install external-secrets external-secrets/external-secrets $(call ver,$(ESO_VERSION)) \
	  -n external-secrets --create-namespace

images: ## Build all images
	docker build -t kahawa/ui:$(TAG)           ui
	docker build -t kahawa/gateway:$(TAG)      gateway
	docker build -t kahawa/kahawa-tools:$(TAG) mcp/kahawa-tools
	docker build -t kahawa/farm-weather:$(TAG) mcp/farm-weather
	docker build -t kahawa/records-fs:$(TAG)   mcp/records-fs
	docker build -t kahawa/fake-imds:$(TAG)    attacker/fake-imds
	docker build -t kahawa/postgres:$(TAG)     data/postgres

load: ## Load images into the kind nodes
	for i in $(IMAGES); do \
	  kind load docker-image kahawa/$$i:$(TAG) --name $(CLUSTER); done

stage: ## Copy packs, prompts and the files the chart embeds into the chart dir
	@rm -rf $(CHART)/packs $(CHART)/prompts
	@cp -R packs $(CHART)/packs
	@cp -R prompts $(CHART)/prompts
	@mkdir -p $(CHART)/files
	@cp ui/nginx.conf data/schema.sql $(CHART)/files/

deploy: stage ## Deploy the chart for PROFILE, PACK and PROVIDER
	helm upgrade --install kahawa $(CHART) \
	  -f $(CHART)/values.yaml -f $(CHART)/values-$(PROFILE).yaml \
	  --set pack=$(PACK) --set image.tag=$(TAG) --set llm.provider=$(PROVIDER)

ollama: ## Pull the local chat and embedding models into Ollama
	ollama pull $(OLLAMA_CHAT_MODEL)
	ollama pull $(OLLAMA_EMBED_MODEL)
	@echo "Run Ollama with OLLAMA_HOST set to the kind network gateway, e.g. 172.18.0.1:11434"

naked: ## Remove policies and redeploy the naked profile
	-kubectl delete -R -f deploy/policies/kyverno --ignore-not-found
	-kubectl delete -R -f deploy/policies/cilium --ignore-not-found
	-kubectl delete -R -f deploy/policies/tetragon --ignore-not-found
	$(MAKE) deploy PROFILE=naked PROVIDER=$(PROVIDER)

harden: ## Apply admission policies, redeploy hardened, then network and runtime policies
	kubectl apply -R -f deploy/policies/kyverno
	$(MAKE) deploy PROFILE=hardened PROVIDER=$(PROVIDER)
	kubectl apply -f deploy/policies/cilium/
	kubectl apply -f deploy/policies/cilium/providers/$(PROVIDER).yaml
	kubectl apply -R -f deploy/policies/tetragon
	kubectl get pods -A -l app.kubernetes.io/part-of=kahawa-guard

swap: ## Change the active pack, e.g. make swap PACK=health
	./scripts/admin.sh pack $(PACK)

reset: ## Reseed data and reset switches for the current profile and pack
	./scripts/reset.sh $(PROFILE) $(PACK)

ui: ## Port-forward the chat screen and admin panel to localhost:8080
	kubectl -n kahawa-ui port-forward svc/kahawa-ui 8080:8080

hubble: ## Open the Hubble UI
	cilium hubble ui

mcp-forward: ## Port-forward kahawa-tools to :8000 and farm-weather to :8100
	./scripts/port-forwards.sh mcp

inspector: ## Open the Inspector web client; add URL=http://localhost:8100/mcp for farm-weather
	$(INSPECTOR) --server-url $(or $(URL),$(TOOLS_URL)) --transport http

mcp-list: ## List tools on both servers with the Inspector CLI
	$(INSPECTOR) --cli $(TOOLS_URL) --transport http --method tools/list
	$(INSPECTOR) --cli $(WEATHER_URL) --transport http --method tools/list

mcp-tui: ## Open the Inspector terminal UI on kahawa-tools
	$(INSPECTOR) --tui --server-url $(TOOLS_URL) --transport http

mcp-test: ## Smoke-test every kahawa-tools tool through the Inspector CLI
	./mcp/tests/smoke.sh $(TOOLS_URL)

mcp-pin: ## Print the tool-list hash for each server
	./scripts/mcp-pin.sh print $(TOOLS_URL) $(WEATHER_URL)

mcp-check: ## Fail if any server's tool list differs from mcp/tests/pins.json
	./scripts/mcp-pin.sh check $(TOOLS_URL) $(WEATHER_URL)

events: ## Stream Tetragon events for the app namespaces
	kubectl exec -n kube-system ds/tetragon -c tetragon -- \
	  tetra getevents -o compact --namespace tools,n8n,gateway

scene1: ## Mixed-language jailbreak
	./scenes/scene1.sh
scene2: ## Fake Coffee Board circular
	./scenes/scene2.sh
scene3: ## Rogue tool and redirected payout
	./scenes/scene3.sh
scene3b: ## Agent reaches past the app
	./scenes/scene3b.sh
scene3c: ## Untrusted file server escapes its directory, Tetragon stops it
	./scenes/scene3c.sh
scene4: ## Laundered plot
	./scenes/scene4.sh

prove-admission: ## Show Kyverno refusing the old naked pod
	-kubectl apply -f scenes/naked-pod.yaml

redteam: ## Run the red-team prompt set against the gateway and report scores
	uv run --project gateway python -m app.redteam redteam/coffee_ki_sw_en.jsonl
