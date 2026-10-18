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
# nginx.conf is also mounted from a ConfigMap by the chart at the same path, so
# this baked-in copy is only what runs before the chart's volume mount takes
# over, and what you get running the image standalone for a quick local check.
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
