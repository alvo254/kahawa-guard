# versions.mk — pinned tool and chart versions.
# An empty value means "the chart's latest release", which is fine while building
# but MUST be pinned before rehearsals. Test the full stack a week before the session.
CILIUM_VERSION     ?= 1.20.3
# Tetragon is installed AS PART OF the Cilium release now (tetragon.enabled=true
# in cilium-values.yaml), not as its own helm release — there is no separate
# TETRAGON_VERSION to pin; it tracks whatever Tetragon chart Cilium 1.20.3 bundles.
GATEWAY_API_VERSION ?= v1.3.0
KYVERNO_VERSION    ?=
VAULT_VERSION      ?=
ESO_VERSION        ?=
INSPECTOR_VERSION  ?= latest   # pin a current release; never older than 0.14.1 (CVE-2025-49596)
OLLAMA_CHAT_MODEL  ?= mistral-small3.2
OLLAMA_EMBED_MODEL ?= nomic-embed-text
