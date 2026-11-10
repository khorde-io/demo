# The public demo HMI as static files behind nginx. Build from the repository
# root, or use deploy/build-image.sh:
#
#   docker build -f deploy/Dockerfile .
#
# The image has no config.json: mount the deployment's at
# /usr/share/nginx/html/config.json. See docs/public-demo.md.

# The output is plain JavaScript, so this stage runs natively whatever the target is.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /src
COPY . .
RUN npm ci
RUN npm run build:public -w @khorde/demo-electrical

# Runs as a non-root user and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/demo-electrical/dist /usr/share/nginx/html
EXPOSE 8080
