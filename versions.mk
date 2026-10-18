# versions.mk — pinned tool and chart versions.
# An empty value means "the chart's latest release", which is fine while building
# but MUST be pinned before rehearsals. Test the full stack a week before the session.
CILIUM_VERSION     ?=
TETRAGON_VERSION   ?=
KYVERNO_VERSION    ?=
VAULT_VERSION      ?=
ESO_VERSION        ?=
INSPECTOR_VERSION  ?= latest   # pin a current release; never older than 0.14.1 (CVE-2025-49596)
OLLAMA_CHAT_MODEL  ?= mistral-small3.2
OLLAMA_EMBED_MODEL ?= nomic-embed-text
