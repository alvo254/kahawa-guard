# Build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# Runtime: unprivileged nginx, non-root, on 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
# nginx.conf is also mounted from a ConfigMap by the chart at the same path,
# overriding this baked-in copy — the chart's version is what actually runs.
#
# This image will NOT start with a bare `docker run`: nginx.conf's proxy_pass
# target (gateway.gateway.svc.cluster.local) is a Kubernetes-internal DNS name
# that only resolves via CoreDNS inside a real cluster, and nginx resolves
# proxy_pass hostnames once at startup, refusing to launch at all if that
# fails. Load it into kind and reach it through the chart's Service instead —
# see RUNBOOK.md section 13.
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
