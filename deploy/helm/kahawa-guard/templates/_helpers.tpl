{{/* Common labels. part-of is what `make harden` greps for. */}}
{{- define "kahawa.labels" -}}
app.kubernetes.io/part-of: kahawa-guard
app.kubernetes.io/managed-by: {{ .Release.Service }}
kahawa.io/profile: {{ .Values.profile }}
{{- end -}}

{{/* Pod-level security context. Empty in the naked profile on purpose. */}}
{{- define "kahawa.podSecurityContext" -}}
{{- if .Values.security.restricted }}
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  fsGroup: 10001
  seccompProfile:
    type: RuntimeDefault
{{- end }}
{{- end -}}

{{/* Container-level security context. */}}
{{- define "kahawa.containerSecurityContext" -}}
{{- if .Values.security.restricted }}
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: {{ .Values.security.readOnlyRootFilesystem }}
  runAsNonRoot: true
  capabilities:
    drop: ["ALL"]
{{- end }}
{{- end -}}

{{/*
Resources for a named component.
Usage: {{ include "kahawa.resources" (dict "root" . "component" "gateway") }}
*/}}
{{- define "kahawa.resources" -}}
{{- $root := .root -}}
{{- if $root.Values.resources.enabled }}
resources:
{{- $r := index $root.Values.resources .component | default $root.Values.resources.default }}
{{ toYaml $r | indent 2 }}
{{- end }}
{{- end -}}

{{/* Image reference for a component. */}}
{{- define "kahawa.image" -}}
{{- printf "%s/%s:%s" .root.Values.image.registry .name .root.Values.image.tag -}}
{{- end -}}
