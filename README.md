# One Service, Two Deployment Environments

This project runs one small Node.js web service in two places:

1. **Docker Compose inside a Linux VM** (Lima, Ubuntu 24.04)
2. **A local Kubernetes cluster** (k3d / k3s) with 2 replicas behind a Service

Both places use the **same container image**.

> **Walkthrough recording:** : https://drive.google.com/file/d/1zszA8gDoi0h59_pzjm9BTc9rp3LqUFSI/view?usp=drive_link
>
> **Report:** [REPORT.md](REPORT.md) · **Evidence log:** [EVIDENCE.md](EVIDENCE.md)

## Files

| File | What it is |
| --- | --- |
| `src/server.js`, `test/service.test.js`, `package.json` | The service and its test |
| `Dockerfile`, `.dockerignore` | Builds the image `cs554-midterm:1.0.0` |
| `compose.yaml` | Compose setup used inside the VM |
| `k8s.yaml` | Kubernetes Deployment (2 replicas) and Service |
| `REPORT.md` | The full technical report |
| `architecture.svg`, `plaintexttouml.puml` | Architecture diagram and its source |
| `EVIDENCE.md` | Terminal output that proves each step |

## Where each requirement is shown

| Requirement | Evidence | Explained in |
| --- | --- | --- |
| Build the image and use it in both places | [Image build](EVIDENCE.md#image-build-host-macos-arm64-docker-desktop) | Step 1 below |
| Part 2: Compose in the VM | [Part 2](EVIDENCE.md#part-2-docker-compose-inside-a-linux-vm-lima) | REPORT §2 and §3 |
| Part 3: Deployment with 2 ready replicas | [Part 3 deployment](EVIDENCE.md#part-3-kubernetes-k3d-deployment) | REPORT §4 |
| Part 3: Pod replacement | [Pod replacement](EVIDENCE.md#part-3-pod-deletion-and-replacement) | REPORT §4 |
| Part 4: Broken Service selector and fix | [Selector failure](EVIDENCE.md#part-4-controlled-service-selector-failure) | REPORT §5 |
| Readiness test | [Readiness](EVIDENCE.md#cs-554-readiness-experiment-one-replica-notready-process-still-running) | REPORT §6 |
| CPU and memory limits | [Resources](EVIDENCE.md#cs-554-measured-usage-vs-requests-and-limits) | REPORT §6 |
| Part 5: OpenStack plan | — | REPORT §7 |

## About the service

| Endpoint | What it returns |
| --- | --- |
| `GET /` | JSON with `service`, `message`, `hostname`, `requestCount` |
| `GET /health` | `200 {"status":"ok"}` when ready |
| Anything else | `404` |

**Settings (environment variables)**

- `PORT` — default is 8080
- `SERVICE_NAME` — name shown in the reply
- `MESSAGE` — message shown in the reply
- `NOT_READY_FILE` — used for the readiness test

**Request counter**

- It counts only `GET /` calls.
- It lives in memory, inside the running process.
- It starts at 0 every time the process starts.
- Each replica has its own counter.

**Readiness switch **

- If the file named in `NOT_READY_FILE` exists, `/health` returns `503`.
- `GET /` still works normally.
- This lets us make one Pod "not ready" without stopping it.
- Why a file? Kubernetes does not let you edit the probe of a running Pod.
- Compose does not set this variable.

All logs go to stdout, so you can see them with `docker compose logs` or `kubectl logs`.

## What you need

| Tool | Version used | Used for |
| --- | --- | --- |
| Mac with Apple Silicon | macOS 14.6 | The main computer |
| Docker Desktop | Engine 28.1.1 | Builds the image and runs k3d |
| Lima | 2.2.1 | Creates the Ubuntu VM |
| Docker + Compose (in the VM) | 29.1.3 + 2.40.3 | Runs Compose inside the VM |
| k3d | 5.9.0 (k3s v1.35.5) | Local Kubernetes cluster |
| kubectl | 1.32.2 | Talks to the cluster |
| Node.js | 22+ (optional) | Runs `npm test` |

**One-time setup**

1. Install Docker Desktop and **start it**.
2. Run `brew install k3d kubectl lima`.
3. Make sure you have internet the first time. It downloads Ubuntu, Docker and the Node base image.

**Order to follow**

1. Build the image (Step 1).
2. Then do Step 2 (VM) and Step 3 (Kubernetes) in any order.

## Step 1. Build the image

```bash
npm test
docker build --provenance=false -t cs554-midterm:1.0.0 .
mkdir -p build
docker save cs554-midterm:1.0.0 -o build/cs554-midterm-1.0.0.tar
```

- `--provenance=false` makes a plain image that both `docker load` and `k3d image import` accept.

**How the image gets to each place**

- There is no registry. The image is built once and copied.

| Place | How it gets there | How to check |
| --- | --- | --- |
| Lima VM | `docker save` → `limactl copy` → `docker load` | `sudo docker save cs554-midterm:1.0.0 \| tar -xO manifest.json` shows `sha256:88e5976c698e…` |
| k3d cluster | `k3d image import` and `imagePullPolicy: Never` | `docker exec k3d-cs554-agent-0 crictl images` shows `88e5976c698e…` |

- Same digest in both places = same image.
- Note: `docker images` in the VM shows a different ID. Docker 29 shows a different kind of digest there. The image is still the same.

## Step 2. Docker Compose in a Lima VM

**How the network works**

- The VM gets its own address: `192.168.64.2`.
- The Mac can reach that address directly.
- So you just call `http://<VM_IP>:8080`. No port forwarding is needed.
- Inside the VM, Compose maps container port 8080 to VM port 8080.

**Create the VM and load the image**

```bash
limactl start --name=cs554-vm --tty=false --vm-type=vz --network=vzNAT \
  --cpus=2 --memory=2 --disk=10 --mount-none template:ubuntu-24.04
limactl shell cs554-vm sudo apt-get update
limactl shell cs554-vm sudo apt-get install -y docker.io docker-compose-v2
limactl shell cs554-vm sudo bash -c 'install -d -o "$SUDO_USER" /opt/app'
limactl copy build/cs554-midterm-1.0.0.tar cs554-vm:/opt/app/image.tar
limactl copy compose.yaml cs554-vm:/opt/app/compose.yaml
limactl shell --workdir /opt/app cs554-vm sudo docker load -i image.tar
```

**Start, check and restart (inside the VM)**

```bash
limactl shell --workdir /opt/app cs554-vm
sudo docker compose up -d
sudo docker compose ps
curl localhost:8080/health
curl localhost:8080/
sudo docker compose logs web
sudo docker compose restart web
exit
```

**Call it from the Mac**

```bash
VM_IP=$(limactl shell cs554-vm ip -4 -o addr show lima0 | awk '{print $4}' | cut -d/ -f1)
curl http://$VM_IP:8080/health
curl http://$VM_IP:8080/
```

- We use `sudo` with `docker` because the VM user is not in the `docker` group.

## Step 3. Kubernetes with k3d

**Where it runs**

- k3d runs each Kubernetes node as a Docker container.
- There are 3 nodes: 1 server and 2 agents.
- They run inside Docker Desktop on the Mac. This is separate from the Lima VM.

**Create the cluster and deploy**

```bash
k3d cluster create cs554 --agents 2 --k3s-arg "--disable=traefik@server:0" --wait
k3d image import cs554-midterm:1.0.0 -c cs554
kubectl apply -f k8s.yaml
kubectl run client --image=cs554-midterm:1.0.0 --image-pull-policy=Never --restart=Never --command -- sleep 86400
kubectl rollout status deployment/cs554-midterm
```

**Check it**

```bash
kubectl get deployment,replicaset,pods,service -o wide
kubectl get endpointslices -l kubernetes.io/service-name=cs554-midterm
kubectl logs -l app=cs554-midterm --prefix
```

**Call it (two ways)**

```bash
# Way 1: from a Pod inside the cluster, through the Service.
# Requests are spread across Pods, so you see both hostnames.
kubectl exec client -- sh -c 'for i in $(seq 1 8); do wget -qO- http://cs554-midterm/; echo; done'

# Way 2: from the Mac with port-forward.
# This always talks to ONE Pod. It does not show load balancing.
kubectl port-forward svc/cs554-midterm 18080:80 &
curl http://localhost:18080/
kill %1
```

**Experiments**

```bash
# 1. Pod replacement: delete one Pod and watch a new one appear
kubectl delete pod <one-pod>
kubectl get pods -l app=cs554-midterm -w

# 2. Break the Service selector, look at it, then fix it
kubectl patch service cs554-midterm --type=merge \
  -p '{"spec":{"selector":{"app":"cs554-midterm-typo"}}}'
kubectl get endpointslices -l kubernetes.io/service-name=cs554-midterm
kubectl apply -f k8s.yaml

# 3. Make ONE Pod not ready (it keeps running), then undo it
kubectl exec <one-pod> -- touch /tmp/not-ready
kubectl get pods -l app=cs554-midterm                                    # that Pod shows 0/1, 0 restarts
kubectl get endpointslices -l kubernetes.io/service-name=cs554-midterm \
  -o jsonpath='{range .items[*].endpoints[*]}{.targetRef.name}{"  ready="}{.conditions.ready}{"\n"}{end}'   # that Pod shows ready=false
kubectl exec <one-pod> -- rm /tmp/not-ready
```

## Clean up

```bash
# Kubernetes
kubectl delete -f k8s.yaml
kubectl delete pod client
k3d cluster delete cs554

# VM
limactl shell --workdir /opt/app cs554-vm sudo docker compose down
limactl delete --force cs554-vm

# Mac
rm -rf build/
```
