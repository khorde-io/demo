#!/usr/bin/env bash
#
# Builds the public demo's images and pushes them to the registry: the HMI
# (nginx serving the static build) and the plant simulator (Node).
#
#   deploy/build-image.sh               build and push both
#   deploy/build-image.sh --only sim    only one of them: hmi or sim
#   deploy/build-image.sh --tag v1.2    push under this tag instead of the commit
#   deploy/build-image.sh --local       build into the local Docker only, as <name>:local
#
# The registry comes from deploy/registry.env or the environment (REGISTRY,
# IMAGE_NAME, SIM_IMAGE_NAME, PLATFORMS; the environment wins). See
# deploy/registry.env.example.
#
# The tag is the short commit. A tree with uncommitted changes gets "-dirty"
# added, and only a clean build moves "latest".

set -euo pipefail
cd "$(dirname "$0")/.."

usage() { sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'; }

local_only=false
tag=""
only=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) local_only=true ;;
    --tag | --only)
      [[ $# -ge 2 ]] || { echo "$1 needs a value" >&2; exit 2; }
      if [[ "$1" == --tag ]]; then tag="$2"; else only="$2"; fi
      shift
      ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
case "$only" in
  "" | hmi | sim) ;;
  *) echo "--only takes hmi or sim" >&2; exit 2 ;;
esac

from_env_registry="${REGISTRY:-}"
from_env_name="${IMAGE_NAME:-}"
from_env_sim_name="${SIM_IMAGE_NAME:-}"
from_env_platforms="${PLATFORMS:-}"
if [[ -f deploy/registry.env ]]; then
  # shellcheck disable=SC1091
  source deploy/registry.env
fi
registry="${from_env_registry:-${REGISTRY:-}}"
hmi_name="${from_env_name:-${IMAGE_NAME:-khorde-demo-hmi}}"
sim_name="${from_env_sim_name:-${SIM_IMAGE_NAME:-khorde-demo-sim}}"
platforms="${from_env_platforms:-${PLATFORMS:-linux/amd64}}"

# Each image: its Dockerfile and its name. Each Dockerfile has its own ignore file.
images=()
[[ "$only" == sim ]] || images+=("deploy/Dockerfile $hmi_name")
[[ "$only" == hmi ]] || images+=("deploy/Dockerfile.sim $sim_name")

if [[ "$local_only" == true ]]; then
  for entry in "${images[@]}"; do
    read -r file name <<<"$entry"
    docker buildx build -f "$file" --load --tag "$name:local" .
    echo "Built $name:local"
  done
  exit 0
fi

if [[ -z "$registry" ]]; then
  echo "No registry set. Copy deploy/registry.env.example to deploy/registry.env, or set REGISTRY." >&2
  echo "To build without pushing, use --local." >&2
  exit 1
fi

latest=false
if [[ -z "$tag" ]]; then
  tag="$(git rev-parse --short HEAD)"
  if [[ -n "$(git status --porcelain)" ]]; then
    tag="$tag-dirty"
    echo "Uncommitted changes: tagging $tag and leaving latest alone." >&2
  else
    latest=true
  fi
fi

for entry in "${images[@]}"; do
  read -r file name <<<"$entry"
  image="${registry%/}/$name"
  tags=(--tag "$image:$tag")
  [[ "$latest" == true ]] && tags+=(--tag "$image:latest")
  docker buildx build -f "$file" --platform "$platforms" "${tags[@]}" --push .
  echo "Pushed $image:$tag"
done
