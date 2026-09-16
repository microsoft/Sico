# Linux Workstation Sandbox

Linux development container providing a browser, code-server, terminal, and VNC desktop. Sico discovers the container as a sandbox resource and proxies its UI through the Backend.

## Sico Local Deployments

From the repository root, either local deployment command builds and starts one workstation automatically:

```bash
make compose-up
make kind-up
```

The workstation is exposed at http://localhost:14008. Its health endpoint is `/health`.

## Standalone Docker

Run the repository helper from the repository root:

```bash
bash scripts/build-linux-workstation-local.sh
docker run --rm -p 8080:8080 sico/linux-workstation-sandbox:local
```

The UI is available at http://localhost:8080/index.html.

To build manually from this directory:

```bash
docker build \
	-f deployments/docker/linux-workstation/Dockerfile.base \
	-t sico/linux-workstation-sandbox-base:local \
	.
docker build \
	-f deployments/docker/linux-workstation/Dockerfile \
	--build-arg BASE_IMAGE=sico/linux-workstation-sandbox-base:local \
	-t sico/linux-workstation-sandbox:local \
	.
```

## Helm

The chart is registry-neutral. Override `image.repository` and `image.tag` for the registry available to the target cluster:

```bash
helm upgrade --install linux-workstation-sandbox deployments/helm \
	--namespace sandbox \
	--create-namespace \
	--set image.repository=registry.example/sico/linux-workstation-sandbox \
	--set image.tag=latest
```

For local inspection of a Kind deployment:

```bash
kubectl -n sandbox port-forward svc/linux-workstation-sandbox 8080:8080
```
