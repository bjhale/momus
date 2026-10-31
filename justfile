# justfile

image := "momus-dev"

default:
    @just --list

# Typecheck, run the suite, then build the local docker image
build: typecheck test docker

typecheck:
    bunx tsc --noEmit

test:
    bun run test

# Build the local docker image only, skipping the checks
docker:
    docker build -t {{image}} .
