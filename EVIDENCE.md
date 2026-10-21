# Evidence log

Verbatim terminal output from running the steps in the README. Each command follows `$`; failures show their exit status.

<!-- step:build -->
## Image build (host: macOS arm64, Docker Desktop)

_Recorded 2026-10-18 19:28 CDT_

```console
$ npm test 2>&1 | grep -E '^(✔|✖|ℹ (pass|fail))'
✔ configured responses, local counter, health, and fresh instance (38.995625ms)
✔ readiness toggle fails /health only while the marker file exists (3.489333ms)
ℹ pass 2
ℹ fail 0
```

`--provenance=false` gives a plain single-platform image that `docker load` and `k3d image import` accept. The config digest below is the image ID seen later in the VM and in the k3d nodes.

```console
$ docker build --provenance=false -t cs554-midterm:1.0.0 . 2>&1 | grep -E 'FROM|exporting config|naming to.*done'
#5 [1/4] FROM docker.io/library/node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
#9 exporting config sha256:88e5976c698e0999c8e6a886876cf9c0af27fbb557bbf0592f5f900ce4161d27 done
#9 naming to docker.io/library/cs554-midterm:1.0.0 done
```

```console
$ docker image inspect cs554-midterm:1.0.0 --format 'arch={{.Architecture}} user={{.Config.User}} cmd={{.Config.Cmd}}'
arch=arm64 user=node cmd=[node src/server.js]
```

```console
$ docker save cs554-midterm:1.0.0 -o build/cs554-midterm-1.0.0.tar && ls -lh build/cs554-midterm-1.0.0.tar
-rw-------@ 1 adhikari25-mbp  staff    58M Oct 18 19:28 build/cs554-midterm-1.0.0.tar
```

Config digest recorded inside the saved image (compare with the VM and the k3d nodes):

```console
$ tar -xOf build/cs554-midterm-1.0.0.tar manifest.json | grep -oE 'Config.{3}blobs/sha256/[0-9a-f]+'
Config":"blobs/sha256/88e5976c698e0999c8e6a886876cf9c0af27fbb557bbf0592f5f900ce4161d27
```
<!-- /step -->

<!-- step:vm -->
## Part 2: Docker Compose inside a Linux VM (Lima)

_Recorded 2026-10-18 19:28 CDT_

**VM and networking.** Lima VM on Apple's Virtualization.framework with a `vzNAT` network: the VM gets a private address on a NAT network that the Mac routes to directly, so no port-forward rule is needed. The VM has no host folders mounted; files are copied in.

```console
$ limactl list cs554-vm
NAME        STATUS     SSH                VMTYPE    ARCH       CPUS    MEMORY    DISK     DIR
cs554-vm    Running    127.0.0.1:59437    vz        aarch64    2       2GiB      10GiB    ~/.lima/cs554-vm
```

```console
$ limactl shell --workdir /opt/app cs554-vm bash -c 'hostname; uname -srm; ip -4 -br addr show scope global; docker --version; docker compose version'
lima-cs554-vm
Linux 6.8.0-142-generic aarch64
eth0             UP             192.168.5.15/24 metric 200 
lima0            UP             192.168.64.2/24 metric 100 
docker0          DOWN           172.17.0.1/16 
Docker version 29.1.3, build 29.1.3-0ubuntu3~24.04.2
Docker Compose version 2.40.3+ds1-0ubuntu1~24.04.1
```

```console
$ route -n get 192.168.64.2 | grep -E 'route to|interface'; ifconfig | grep -B4 'inet 192.168.64\.' | grep -E '^[a-z]|inet '
   route to: 192.168.64.2
  interface: bridge100
bridge100: flags=8a63<UP,BROADCAST,SMART,RUNNING,ALLMULTI,SIMPLEX,MULTICAST> mtu 1500
	inet 192.168.64.1 netmask 0xffffff00 broadcast 192.168.64.255
```

**Same image**, moved host → VM with `docker save` / `limactl copy` / `docker load` (no registry). Docker 29 here uses the containerd image store, so the listed ID is a manifest digest, which changes when save/load re-packs layers. The config digest inside the image is the stable ID, and it matches the build and the k3d nodes.

```console
$ limactl shell --workdir /opt/app cs554-vm sudo docker load -i image.tar && limactl shell --workdir /opt/app cs554-vm rm image.tar
Loaded image: cs554-midterm:1.0.0
```

```console
$ limactl shell --workdir /opt/app cs554-vm sudo docker image ls cs554-midterm --format '{{.Repository}}:{{.Tag}}  listed ID={{.ID}}'
cs554-midterm:1.0.0  listed ID=6566808e50d3
```

```console
$ limactl shell --workdir /opt/app cs554-vm bash -c 'sudo docker save cs554-midterm:1.0.0 | tar -xO manifest.json | grep -oE "Config.{3}blobs/sha256/[0-9a-f]+"'
Config":"blobs/sha256/88e5976c698e0999c8e6a886876cf9c0af27fbb557bbf0592f5f900ce4161d27
```

**Start and status.**

```console
$ limactl shell --workdir /opt/app cs554-vm cat compose.yaml
name: cs554-midterm
services:
  web:
    # Built once on the host and copied into the VM with docker save/load,
    # so Compose and Kubernetes run the identical image.
    image: cs554-midterm:1.0.0
    pull_policy: never
    environment:
      PORT: "8080"
      SERVICE_NAME: compose-in-vm
      MESSAGE: Hello from Docker Compose inside the Lima VM
    ports:
      - "8080:8080"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/health"]
      interval: 10s
      timeout: 2s
      retries: 3
      start_period: 5s
```

```console
$ limactl shell --workdir /opt/app cs554-vm sudo docker compose up -d
 Network cs554-midterm_default  Creating
 Network cs554-midterm_default  Created
 Container cs554-midterm-web-1  Creating
 Container cs554-midterm-web-1  Created
 Container cs554-midterm-web-1  Starting
 Container cs554-midterm-web-1  Started
```

```console
$ limactl shell --workdir /opt/app cs554-vm sudo docker compose ps
NAME                  IMAGE                 COMMAND                  SERVICE   CREATED         STATUS                   PORTS
cs554-midterm-web-1   cs554-midterm:1.0.0   "docker-entrypoint.s…"   web       6 seconds ago   Up 6 seconds (healthy)   0.0.0.0:8080->8080/tcp, [::]:8080->8080/tcp
```

**Requests inside the VM.**

```console
$ limactl shell --workdir /opt/app cs554-vm bash -c 'curl -s -w " HTTP %{http_code}" localhost:8080/health; echo; for i in 1 2 3; do curl -s localhost:8080/; echo; done'
{"status":"ok"} HTTP 200
{"service":"compose-in-vm","message":"Hello from Docker Compose inside the Lima VM","hostname":"ebef897c9d01","requestCount":1}
{"service":"compose-in-vm","message":"Hello from Docker Compose inside the Lima VM","hostname":"ebef897c9d01","requestCount":2}
{"service":"compose-in-vm","message":"Hello from Docker Compose inside the Lima VM","hostname":"ebef897c9d01","requestCount":3}
```

**Request from the Mac host** to the VM at 192.168.64.2:8080.

```console
$ curl -s -w ' HTTP %{http_code}' http://192.168.64.2:8080/health; echo; curl -s http://192.168.64.2:8080/; echo
{"status":"ok"} HTTP 200
{"service":"compose-in-vm","message":"Hello from Docker Compose inside the Lima VM","hostname":"ebef897c9d01","requestCount":4}
```

**Port path inside the VM:** VM :8080 → Docker NAT rule → container :8080.

```console
$ limactl shell --workdir /opt/app cs554-vm sudo ss -ltnp 'sport = :8080'
State  Recv-Q Send-Q Local Address:Port Peer Address:PortProcess                                
LISTEN 0      4096         0.0.0.0:8080      0.0.0.0:*    users:(("docker-proxy",pid=5361,fd=7))
LISTEN 0      4096            [::]:8080         [::]:*    users:(("docker-proxy",pid=5369,fd=7))
```

```console
$ limactl shell --workdir /opt/app cs554-vm sudo iptables -t nat -S DOCKER | grep 8080
-A DOCKER ! -i br-9166db6b576e -p tcp -m tcp --dport 8080 -j DNAT --to-destination 172.18.0.2:8080
```

```console
$ limactl shell --workdir /opt/app cs554-vm sudo docker inspect -f 'container IP={{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' cs554-midterm-web-1
container IP=172.18.0.2
```

**Logs.**

```console
$ limactl shell --workdir /opt/app cs554-vm sudo docker compose logs --no-color --timestamps web | tail -8
web-1  | 2026-10-19T00:28:28.440564070Z Listening on port 8080
web-1  | 2026-10-19T00:28:33.447184910Z {"method":"GET","path":"/health","status":200}
web-1  | 2026-10-19T00:28:34.691878891Z {"method":"GET","path":"/health","status":200}
web-1  | 2026-10-19T00:28:34.694385660Z {"method":"GET","path":"/","status":200}
web-1  | 2026-10-19T00:28:34.697387090Z {"method":"GET","path":"/","status":200}
web-1  | 2026-10-19T00:28:34.699888650Z {"method":"GET","path":"/","status":200}
web-1  | 2026-10-19T00:28:34.743025459Z {"method":"GET","path":"/health","status":200}
web-1  | 2026-10-19T00:28:34.754332062Z {"method":"GET","path":"/","status":200}
```

**Restart.** Same container, new process, so requestCount starts over.

```console
$ limactl shell --workdir /opt/app cs554-vm sudo docker inspect -f 'started={{.State.StartedAt}} restarts={{.RestartCount}}' cs554-midterm-web-1
started=2026-10-19T00:28:28.342312507Z restarts=0
```

```console
$ limactl shell --workdir /opt/app cs554-vm sudo docker compose restart web
 Container cs554-midterm-web-1  Restarting
 Container cs554-midterm-web-1  Started
```

```console
$ limactl shell --workdir /opt/app cs554-vm sudo docker inspect -f 'started={{.State.StartedAt}} restarts={{.RestartCount}}' cs554-midterm-web-1
started=2026-10-19T00:28:35.357167989Z restarts=0
```

```console
$ curl -s http://192.168.64.2:8080/; echo; curl -s http://192.168.64.2:8080/; echo
{"service":"compose-in-vm","message":"Hello from Docker Compose inside the Lima VM","hostname":"ebef897c9d01","requestCount":1}
{"service":"compose-in-vm","message":"Hello from Docker Compose inside the Lima VM","hostname":"ebef897c9d01","requestCount":2}
```

```console
$ limactl shell --workdir /opt/app cs554-vm sudo docker compose logs --no-color web | grep -E 'Listening|Received'
web-1  | Listening on port 8080
web-1  | Received SIGTERM; stopping.
web-1  | Listening on port 8080
```

**Crash (SIGKILL).** Docker's restart policy restarts the same container on the same VM.

```console
$ limactl shell --workdir /opt/app cs554-vm bash -c 'sudo kill -9 $(sudo docker inspect -f {{.State.Pid}} cs554-midterm-web-1)'
```

```console
$ limactl shell --workdir /opt/app cs554-vm sudo docker inspect -f 'started={{.State.StartedAt}} restarts={{.RestartCount}}' cs554-midterm-web-1
started=2026-10-19T00:28:42.09221815Z restarts=1
```

```console
$ curl -s http://192.168.64.2:8080/; echo
{"service":"compose-in-vm","message":"Hello from Docker Compose inside the Lima VM","hostname":"ebef897c9d01","requestCount":1}
```

**down / up.** Compose creates a new container (new hostname); the counter starts at 1 again.

```console
$ limactl shell --workdir /opt/app cs554-vm sudo docker compose down && limactl shell --workdir /opt/app cs554-vm sudo docker compose up -d
 Container cs554-midterm-web-1  Stopping
 Container cs554-midterm-web-1  Stopped
 Container cs554-midterm-web-1  Removing
 Container cs554-midterm-web-1  Removed
 Network cs554-midterm_default  Removing
 Network cs554-midterm_default  Removed
 Network cs554-midterm_default  Creating
 Network cs554-midterm_default  Created
 Container cs554-midterm-web-1  Creating
 Container cs554-midterm-web-1  Created
 Container cs554-midterm-web-1  Starting
 Container cs554-midterm-web-1  Started
```

```console
$ curl -s http://192.168.64.2:8080/; echo
{"service":"compose-in-vm","message":"Hello from Docker Compose inside the Lima VM","hostname":"079690e34b65","requestCount":1}
```
<!-- /step -->

<!-- step:k8s -->
## Part 3: Kubernetes (k3d) deployment

_Recorded 2026-10-18 18:44 CDT_

**Cluster.** k3d runs each node as a Docker container inside Docker Desktop's Linux VM on the Mac, separate from the Lima VM.

```console
$ kubectl get nodes -o wide
NAME                 STATUS   ROLES           AGE   VERSION        INTERNAL-IP   EXTERNAL-IP   OS-IMAGE           KERNEL-VERSION     CONTAINER-RUNTIME
k3d-cs554-agent-0    Ready    <none>          54m   v1.35.5+k3s1   172.22.0.4    <none>        K3s v1.35.5+k3s1   6.10.14-linuxkit   containerd://2.2.3-k3s1
k3d-cs554-agent-1    Ready    <none>          54m   v1.35.5+k3s1   172.22.0.5    <none>        K3s v1.35.5+k3s1   6.10.14-linuxkit   containerd://2.2.3-k3s1
k3d-cs554-server-0   Ready    control-plane   54m   v1.35.5+k3s1   172.22.0.3    <none>        K3s v1.35.5+k3s1   6.10.14-linuxkit   containerd://2.2.3-k3s1
```

**Same image**, imported into every node's containerd (no registry). IMAGE ID = config digest from the build.

```console
$ k3d image import cs554-midterm:1.0.0 -c cs554 2>&1 | tail -1
INFO[0003] Successfully imported 1 image(s) into 1 cluster(s) 
```

```console
$ docker exec k3d-cs554-agent-0 crictl images | grep -E 'IMAGE|cs554-midterm'
IMAGE                                      TAG                 IMAGE ID            SIZE
docker.io/library/cs554-midterm            1.0.0               88e5976c698e0       61.1MB
```

**Deploy** two replicas and a ClusterIP Service, plus a client Pod for in-cluster requests.

```console
$ kubectl apply -f k8s.yaml
deployment.apps/cs554-midterm created
service/cs554-midterm created
```

```console
$ kubectl run client --image=cs554-midterm:1.0.0 --image-pull-policy=Never --restart=Never --command -- sleep 86400
pod/client created
```

```console
$ kubectl rollout status deployment/cs554-midterm --timeout=120s && kubectl wait --for=condition=Ready pod/client --timeout=60s
Waiting for deployment "cs554-midterm" rollout to finish: 0 of 2 updated replicas are available...
Waiting for deployment "cs554-midterm" rollout to finish: 1 of 2 updated replicas are available...
deployment "cs554-midterm" successfully rolled out
pod/client condition met
```

**Two ready replicas.**

```console
$ kubectl get deployment,replicaset -l app=cs554-midterm -o wide
NAME                            READY   UP-TO-DATE   AVAILABLE   AGE   CONTAINERS   IMAGES                SELECTOR
deployment.apps/cs554-midterm   2/2     2            2           4s    web          cs554-midterm:1.0.0   app=cs554-midterm

NAME                                       DESIRED   CURRENT   READY   AGE   CONTAINERS   IMAGES                SELECTOR
replicaset.apps/cs554-midterm-6fcc4dd5b6   2         2         2       4s    web          cs554-midterm:1.0.0   app=cs554-midterm,pod-template-hash=6fcc4dd5b6
```

```console
$ kubectl get pods -l app=cs554-midterm -o wide --show-labels
NAME                             READY   STATUS    RESTARTS   AGE   IP           NODE                 NOMINATED NODE   READINESS GATES   LABELS
cs554-midterm-6fcc4dd5b6-bjrgr   1/1     Running   0          3s    10.42.1.9    k3d-cs554-server-0   <none>           <none>            app=cs554-midterm,pod-template-hash=6fcc4dd5b6
cs554-midterm-6fcc4dd5b6-ksdlb   1/1     Running   0          3s    10.42.2.12   k3d-cs554-agent-0    <none>           <none>            app=cs554-midterm,pod-template-hash=6fcc4dd5b6
```

```console
$ kubectl get service cs554-midterm -o wide
NAME            TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)   AGE   SELECTOR
cs554-midterm   ClusterIP   10.43.64.126   <none>        80/TCP    4s    app=cs554-midterm
```

```console
$ kubectl get endpointslices -l kubernetes.io/service-name=cs554-midterm
NAME                  ADDRESSTYPE   PORTS   ENDPOINTS              AGE
cs554-midterm-wrjfx   IPv4          8080    10.42.2.12,10.42.1.9   4s
```

```console
$ kubectl get endpointslices -l kubernetes.io/service-name=cs554-midterm -o jsonpath='{range .items[*].endpoints[*]}{.targetRef.name}{"  "}{.addresses[0]}{"  ready="}{.conditions.ready}{"\n"}{end}'
cs554-midterm-6fcc4dd5b6-ksdlb  10.42.2.12  ready=true
cs554-midterm-6fcc4dd5b6-bjrgr  10.42.1.9  ready=true
```

**Requests through the Service** from inside the cluster (ClusterIP; kube-proxy picks a ready endpoint per connection, so both hostnames appear).

```console
$ kubectl exec client -- wget -qO- http://cs554-midterm/health; echo
{"status":"ok"}
```

```console
$ kubectl exec client -- sh -c 'for i in $(seq 1 8); do wget -qO- -T 2 http://cs554-midterm/ 2>&1 || echo "(request $i failed)"; echo; done'
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":1}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":2}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-bjrgr","requestCount":1}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-bjrgr","requestCount":2}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":3}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":4}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":5}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-bjrgr","requestCount":3}
```

**From the Mac via port-forward.** The session binds to ONE Pod when it starts: it shows the Service resolves, not load balancing.

```console
$ kubectl port-forward --pod-running-timeout=4s svc/cs554-midterm 18080:80 &
Forwarding from 127.0.0.1:18080 -> 8080
Forwarding from [::1]:18080 -> 8080
$ curl http://localhost:18080/
Handling connection for 18080
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-bjrgr","requestCount":4}
```

**Logs** (stdout of each replica).

```console
$ kubectl logs -l app=cs554-midterm --prefix --tail=4
[pod/cs554-midterm-6fcc4dd5b6-bjrgr/web] {"method":"GET","path":"/","status":200}
[pod/cs554-midterm-6fcc4dd5b6-bjrgr/web] {"method":"GET","path":"/","status":200}
[pod/cs554-midterm-6fcc4dd5b6-bjrgr/web] {"method":"GET","path":"/health","status":200}
[pod/cs554-midterm-6fcc4dd5b6-bjrgr/web] {"method":"GET","path":"/","status":200}
[pod/cs554-midterm-6fcc4dd5b6-ksdlb/web] {"method":"GET","path":"/","status":200}
[pod/cs554-midterm-6fcc4dd5b6-ksdlb/web] {"method":"GET","path":"/","status":200}
[pod/cs554-midterm-6fcc4dd5b6-ksdlb/web] {"method":"GET","path":"/","status":200}
[pod/cs554-midterm-6fcc4dd5b6-ksdlb/web] {"method":"GET","path":"/health","status":200}
```
<!-- /step -->

<!-- step:replace -->
## Part 3: Pod deletion and replacement

_Recorded 2026-10-18 18:45 CDT_

**Before:** desired 2, ready 2.

```console
$ kubectl get deployment cs554-midterm
NAME            READY   UP-TO-DATE   AVAILABLE   AGE
cs554-midterm   2/2     2            2           11s
```

```console
$ kubectl get pods -l app=cs554-midterm -o wide
NAME                             READY   STATUS    RESTARTS   AGE   IP           NODE                 NOMINATED NODE   READINESS GATES
cs554-midterm-6fcc4dd5b6-bjrgr   1/1     Running   0          10s   10.42.1.9    k3d-cs554-server-0   <none>           <none>
cs554-midterm-6fcc4dd5b6-ksdlb   1/1     Running   0          10s   10.42.2.12   k3d-cs554-agent-0    <none>           <none>
```

**Delete one Pod** (cs554-midterm-6fcc4dd5b6-bjrgr) while the Deployment still says `replicas: 2`.

```console
$ kubectl delete pod cs554-midterm-6fcc4dd5b6-bjrgr --wait=false
pod "cs554-midterm-6fcc4dd5b6-bjrgr" deleted
```

```console
$ kubectl rollout status deployment/cs554-midterm --timeout=120s
Waiting for deployment "cs554-midterm" rollout to finish: 1 of 2 updated replicas are available...
Waiting for deployment "cs554-midterm" rollout to finish: 1 of 2 updated replicas are available...
deployment "cs554-midterm" successfully rolled out
```

**Pod watch** recorded during the deletion (`kubectl get pods --watch-only --output-watch-events`).

```console
EVENT      POD                              PHASE     READY
MODIFIED   cs554-midterm-6fcc4dd5b6-bjrgr   Running   true
ADDED      cs554-midterm-6fcc4dd5b6-vcglp   Pending   <none>
MODIFIED   cs554-midterm-6fcc4dd5b6-bjrgr   Running   true
MODIFIED   cs554-midterm-6fcc4dd5b6-vcglp   Pending   <none>
MODIFIED   cs554-midterm-6fcc4dd5b6-vcglp   Pending   false
MODIFIED   cs554-midterm-6fcc4dd5b6-bjrgr   Succeeded   false
MODIFIED   cs554-midterm-6fcc4dd5b6-bjrgr   Succeeded   false
DELETED    cs554-midterm-6fcc4dd5b6-bjrgr   Succeeded   false
MODIFIED   cs554-midterm-6fcc4dd5b6-vcglp   Running     false
MODIFIED   cs554-midterm-6fcc4dd5b6-vcglp   Running     true
```

**After:** a new Pod name, back to 2/2 ready.

```console
$ kubectl get deployment cs554-midterm
NAME            READY   UP-TO-DATE   AVAILABLE   AGE
cs554-midterm   2/2     2            2           22s
```

```console
$ kubectl get pods -l app=cs554-midterm -o wide
NAME                             READY   STATUS    RESTARTS   AGE   IP           NODE                 NOMINATED NODE   READINESS GATES
cs554-midterm-6fcc4dd5b6-ksdlb   1/1     Running   0          21s   10.42.2.12   k3d-cs554-agent-0    <none>           <none>
cs554-midterm-6fcc4dd5b6-vcglp   1/1     Running   0          10s   10.42.1.10   k3d-cs554-server-0   <none>           <none>
```

```console
$ kubectl get endpointslices -l kubernetes.io/service-name=cs554-midterm -o jsonpath='{range .items[*].endpoints[*]}{.targetRef.name}{"  "}{.addresses[0]}{"  ready="}{.conditions.ready}{"\n"}{end}'
cs554-midterm-6fcc4dd5b6-ksdlb  10.42.2.12  ready=true
cs554-midterm-6fcc4dd5b6-vcglp  10.42.1.10  ready=true
```

```console
$ kubectl get events --field-selector involvedObject.uid=e5452485-38e2-4c9c-a589-9ebb5472bc98 --sort-by=.lastTimestamp
LAST SEEN   TYPE     REASON             OBJECT                                MESSAGE
21s         Normal   SuccessfulCreate   replicaset/cs554-midterm-6fcc4dd5b6   Created pod: cs554-midterm-6fcc4dd5b6-bjrgr
21s         Normal   SuccessfulCreate   replicaset/cs554-midterm-6fcc4dd5b6   Created pod: cs554-midterm-6fcc4dd5b6-ksdlb
10s         Normal   SuccessfulCreate   replicaset/cs554-midterm-6fcc4dd5b6   Created pod: cs554-midterm-6fcc4dd5b6-vcglp
```

**The replacement is a new process:** its counter starts at 1.

```console
$ kubectl exec client -- sh -c 'for i in $(seq 1 6); do wget -qO- -T 2 http://cs554-midterm/ 2>&1 || echo "(request $i failed)"; echo; done'
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":1}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":2}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":3}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":4}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":5}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":6}
```
<!-- /step -->

<!-- step:selector -->
## Part 4: Controlled Service-selector failure

_Recorded 2026-10-18 18:45 CDT_

**1. Working baseline.**

```console
$ kubectl get service cs554-midterm -o jsonpath='selector={.spec.selector}{"\n"}'
selector={"app":"cs554-midterm"}
```

```console
$ kubectl get pods -l app=cs554-midterm --show-labels
NAME                             READY   STATUS    RESTARTS   AGE   LABELS
cs554-midterm-6fcc4dd5b6-ksdlb   1/1     Running   0          22s   app=cs554-midterm,pod-template-hash=6fcc4dd5b6
cs554-midterm-6fcc4dd5b6-vcglp   1/1     Running   0          11s   app=cs554-midterm,pod-template-hash=6fcc4dd5b6
```

```console
$ kubectl get endpointslices -l kubernetes.io/service-name=cs554-midterm -o jsonpath='{range .items[*].endpoints[*]}{.targetRef.name}{"  "}{.addresses[0]}{"  ready="}{.conditions.ready}{"\n"}{end}'
cs554-midterm-6fcc4dd5b6-ksdlb  10.42.2.12  ready=true
cs554-midterm-6fcc4dd5b6-vcglp  10.42.1.10  ready=true
```

```console
$ kubectl exec client -- sh -c 'for i in $(seq 1 4); do wget -qO- -T 2 http://cs554-midterm/ 2>&1 || echo "(request $i failed)"; echo; done'
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":6}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":7}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":7}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":8}
```

```console
$ kubectl port-forward --pod-running-timeout=4s svc/cs554-midterm 18080:80 &
Forwarding from 127.0.0.1:18080 -> 8080
Forwarding from [::1]:18080 -> 8080
$ curl http://localhost:18080/
Handling connection for 18080
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":8}
```

**2. Introduce the failure:** change ONLY the Service selector, `app: cs554-midterm` → `app: cs554-midterm-typo`.

```console
$ kubectl patch service cs554-midterm --type=merge -p '{"spec":{"selector":{"app":"cs554-midterm-typo"}}}'
service/cs554-midterm patched
```

**3. Client symptom:** requests through the Service are refused, and a new port-forward session finds no Pod.

```console
$ kubectl exec client -- sh -c 'for i in $(seq 1 3); do wget -qO- -T 2 http://cs554-midterm/ 2>&1 || echo "(request $i failed)"; echo; done'
wget: can't connect to remote host (10.43.64.126): Connection refused
(request 1 failed)

wget: can't connect to remote host (10.43.64.126): Connection refused
(request 2 failed)

wget: can't connect to remote host (10.43.64.126): Connection refused
(request 3 failed)
```

```console
$ kubectl port-forward --pod-running-timeout=4s svc/cs554-midterm 18080:80 &
error: timed out waiting for the condition
$ curl http://localhost:18080/
curl: (7) Failed to connect to localhost port 18080 after 0 ms: Couldn't connect to server

```

**4. Investigation.** The Deployment and Pods are healthy; the Service selects nothing, so its EndpointSlice is empty.

```console
$ kubectl get deployment cs554-midterm
NAME            READY   UP-TO-DATE   AVAILABLE   AGE
cs554-midterm   2/2     2            2           41s
```

```console
$ kubectl get pods -l app=cs554-midterm -o wide --show-labels
NAME                             READY   STATUS    RESTARTS   AGE   IP           NODE                 NOMINATED NODE   READINESS GATES   LABELS
cs554-midterm-6fcc4dd5b6-ksdlb   1/1     Running   0          40s   10.42.2.12   k3d-cs554-agent-0    <none>           <none>            app=cs554-midterm,pod-template-hash=6fcc4dd5b6
cs554-midterm-6fcc4dd5b6-vcglp   1/1     Running   0          29s   10.42.1.10   k3d-cs554-server-0   <none>           <none>            app=cs554-midterm,pod-template-hash=6fcc4dd5b6
```

```console
$ kubectl get service cs554-midterm -o wide
NAME            TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)   AGE   SELECTOR
cs554-midterm   ClusterIP   10.43.64.126   <none>        80/TCP    42s   app=cs554-midterm-typo
```

```console
$ kubectl get pods -l app=cs554-midterm-typo
No resources found in default namespace.
```

```console
$ kubectl get endpointslices -l kubernetes.io/service-name=cs554-midterm
NAME                  ADDRESSTYPE   PORTS     ENDPOINTS   AGE
cs554-midterm-wrjfx   IPv4          <unset>   <unset>     42s
```

```console
$ kubectl describe service cs554-midterm | grep -E 'Selector|Endpoints'
Selector:                 app=cs554-midterm-typo
Endpoints:                
```

A direct request to a Pod IP bypasses the Service and still works:

```console
$ kubectl exec client -- wget -qO- -T 2 http://10.42.2.12:8080/; echo
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":9}
```

**5. Correction:** re-apply the declared manifest (only the Service changes).

```console
$ kubectl apply -f k8s.yaml
deployment.apps/cs554-midterm unchanged
service/cs554-midterm configured
```

**6. Recovery.**

```console
$ kubectl get service cs554-midterm -o jsonpath='selector={.spec.selector}{"\n"}'
selector={"app":"cs554-midterm"}
```

```console
$ kubectl get endpointslices -l kubernetes.io/service-name=cs554-midterm
NAME                  ADDRESSTYPE   PORTS   ENDPOINTS               AGE
cs554-midterm-wrjfx   IPv4          8080    10.42.2.12,10.42.1.10   45s
```

```console
$ kubectl get endpointslices -l kubernetes.io/service-name=cs554-midterm -o jsonpath='{range .items[*].endpoints[*]}{.targetRef.name}{"  "}{.addresses[0]}{"  ready="}{.conditions.ready}{"\n"}{end}'
cs554-midterm-6fcc4dd5b6-ksdlb  10.42.2.12  ready=true
cs554-midterm-6fcc4dd5b6-vcglp  10.42.1.10  ready=true
```

```console
$ kubectl exec client -- sh -c 'for i in $(seq 1 4); do wget -qO- -T 2 http://cs554-midterm/ 2>&1 || echo "(request $i failed)"; echo; done'
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":9}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":10}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":11}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":10}
```

```console
$ kubectl port-forward --pod-running-timeout=4s svc/cs554-midterm 18080:80 &
Forwarding from 127.0.0.1:18080 -> 8080
Forwarding from [::1]:18080 -> 8080
$ curl http://localhost:18080/
Handling connection for 18080
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":11}
```
<!-- /step -->

<!-- step:readiness -->
## CS 554: Readiness experiment (one replica NotReady, process still running)

_Recorded 2026-10-18 18:45 CDT_

Running Pods' probes cannot be edited (`kubectl patch pod` → *pod updates may not change fields other than …*), so the app has a per-Pod toggle: while `/tmp/not-ready` exists, `/health` returns 503.

```console
$ kubectl get deployment cs554-midterm -o jsonpath='{.spec.template.spec.containers[0].readinessProbe}{"\n"}'
{"failureThreshold":2,"httpGet":{"path":"/health","port":"http","scheme":"HTTP"},"initialDelaySeconds":2,"periodSeconds":5,"successThreshold":1,"timeoutSeconds":1}
```

**1. Baseline:** both Pods Ready and both endpoints ready.

```console
$ kubectl get pods -l app=cs554-midterm -o wide
NAME                             READY   STATUS    RESTARTS   AGE   IP           NODE                 NOMINATED NODE   READINESS GATES
cs554-midterm-6fcc4dd5b6-ksdlb   1/1     Running   0          51s   10.42.2.12   k3d-cs554-agent-0    <none>           <none>
cs554-midterm-6fcc4dd5b6-vcglp   1/1     Running   0          40s   10.42.1.10   k3d-cs554-server-0   <none>           <none>
```

```console
$ kubectl get endpointslices -l kubernetes.io/service-name=cs554-midterm -o jsonpath='{range .items[*].endpoints[*]}{.targetRef.name}{"  "}{.addresses[0]}{"  ready="}{.conditions.ready}{"\n"}{end}'
cs554-midterm-6fcc4dd5b6-ksdlb  10.42.2.12  ready=true
cs554-midterm-6fcc4dd5b6-vcglp  10.42.1.10  ready=true
```

```console
$ kubectl exec client -- sh -c 'for i in $(seq 1 8); do wget -qO- -T 2 http://cs554-midterm/ 2>&1 || echo "(request $i failed)"; echo; done'
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":12}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":12}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":13}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":13}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":14}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":15}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":16}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":14}
```

**2. Failure:** create the marker in ONE Pod (cs554-midterm-6fcc4dd5b6-ksdlb) only.

```console
$ kubectl exec cs554-midterm-6fcc4dd5b6-ksdlb -- touch /tmp/not-ready
```

```console
$ kubectl wait --for=condition=Ready=false pod/cs554-midterm-6fcc4dd5b6-ksdlb --timeout=60s
pod/cs554-midterm-6fcc4dd5b6-ksdlb condition met
```

```console
$ kubectl get pods -l app=cs554-midterm -o wide
NAME                             READY   STATUS    RESTARTS   AGE   IP           NODE                 NOMINATED NODE   READINESS GATES
cs554-midterm-6fcc4dd5b6-ksdlb   0/1     Running   0          58s   10.42.2.12   k3d-cs554-agent-0    <none>           <none>
cs554-midterm-6fcc4dd5b6-vcglp   1/1     Running   0          47s   10.42.1.10   k3d-cs554-server-0   <none>           <none>
```

```console
$ kubectl get endpointslices -l kubernetes.io/service-name=cs554-midterm -o jsonpath='{range .items[*].endpoints[*]}{.targetRef.name}{"  "}{.addresses[0]}{"  ready="}{.conditions.ready}{"\n"}{end}'
cs554-midterm-6fcc4dd5b6-ksdlb  10.42.2.12  ready=false
cs554-midterm-6fcc4dd5b6-vcglp  10.42.1.10  ready=true
```

```console
$ kubectl describe pod cs554-midterm-6fcc4dd5b6-ksdlb | grep -E 'Ready:|Restart Count|Readiness|Unhealthy'
    Ready:          False
    Restart Count:  0
    Readiness:  http-get http://:http/health delay=2s timeout=1s period=5s #success=1 #failure=2
  Warning  Unhealthy  1s (x3 over 6s)  kubelet            Readiness probe failed: HTTP probe failed with statuscode: 503
```

The process is still running (PID 1, 0 restarts) and still answers when called directly:

```console
$ kubectl exec cs554-midterm-6fcc4dd5b6-ksdlb -- ps -o pid,etime,args
PID   ELAPSED COMMAND
    1  0:59   node src/server.js
   20  0:01   ps -o pid,etime,args
```

```console
$ kubectl exec client -- wget -qO- -T 2 http://10.42.2.12:8080/; echo
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":15}
```

```console
$ kubectl logs cs554-midterm-6fcc4dd5b6-ksdlb --tail=3
{"method":"GET","path":"/health","status":503}
{"method":"GET","path":"/health","status":503}
{"method":"GET","path":"/","status":200}
```

Requests through the Service now reach only the ready Pod (cs554-midterm-6fcc4dd5b6-vcglp):

```console
$ kubectl exec client -- sh -c 'for i in $(seq 1 8); do wget -qO- -T 2 http://cs554-midterm/ 2>&1 || echo "(request $i failed)"; echo; done'
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":17}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":18}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":19}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":20}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":21}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":22}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":23}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":24}
```

**3. Recovery:** remove the marker; the probe passes again.

```console
$ kubectl exec cs554-midterm-6fcc4dd5b6-ksdlb -- rm /tmp/not-ready
```

```console
$ kubectl wait --for=condition=Ready pod/cs554-midterm-6fcc4dd5b6-ksdlb --timeout=60s
pod/cs554-midterm-6fcc4dd5b6-ksdlb condition met
```

```console
$ kubectl get pods -l app=cs554-midterm -o wide
NAME                             READY   STATUS    RESTARTS   AGE   IP           NODE                 NOMINATED NODE   READINESS GATES
cs554-midterm-6fcc4dd5b6-ksdlb   1/1     Running   0          63s   10.42.2.12   k3d-cs554-agent-0    <none>           <none>
cs554-midterm-6fcc4dd5b6-vcglp   1/1     Running   0          52s   10.42.1.10   k3d-cs554-server-0   <none>           <none>
```

```console
$ kubectl get endpointslices -l kubernetes.io/service-name=cs554-midterm -o jsonpath='{range .items[*].endpoints[*]}{.targetRef.name}{"  "}{.addresses[0]}{"  ready="}{.conditions.ready}{"\n"}{end}'
cs554-midterm-6fcc4dd5b6-ksdlb  10.42.2.12  ready=true
cs554-midterm-6fcc4dd5b6-vcglp  10.42.1.10  ready=true
```

```console
$ kubectl exec client -- sh -c 'for i in $(seq 1 8); do wget -qO- -T 2 http://cs554-midterm/ 2>&1 || echo "(request $i failed)"; echo; done'
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":16}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":25}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":17}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":18}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":26}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":19}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-vcglp","requestCount":27}
{"service":"k3d-deployment","message":"Hello from Kubernetes (k3d)","hostname":"cs554-midterm-6fcc4dd5b6-ksdlb","requestCount":20}
```

**Temporary change removed:** the marker no longer exists, and the Deployment template was never edited.

```console
$ kubectl exec cs554-midterm-6fcc4dd5b6-ksdlb -- ls /tmp/not-ready
ls: /tmp/not-ready: No such file or directory
command terminated with exit code 1
[exit status 1]
```

```console
$ kubectl get deployment cs554-midterm -o jsonpath='generation={.metadata.generation} observedGeneration={.status.observedGeneration}{"\n"}'
generation=1 observedGeneration=1
```
<!-- /step -->

<!-- step:resources -->
## CS 554: Measured usage vs. requests and limits

_Recorded 2026-10-18 18:45 CDT_

```console
$ kubectl get deployment cs554-midterm -o jsonpath='{.spec.template.spec.containers[0].resources}{"\n"}'
{"limits":{"cpu":"250m","memory":"128Mi"},"requests":{"cpu":"50m","memory":"64Mi"}}
```

```console
$ kubectl get pods -l app=cs554-midterm -o custom-columns='POD:.metadata.name,NODE:.spec.nodeName,QOS:.status.qosClass'
POD                              NODE                 QOS
cs554-midterm-6fcc4dd5b6-ksdlb   k3d-cs554-agent-0    Burstable
cs554-midterm-6fcc4dd5b6-vcglp   k3d-cs554-server-0   Burstable
```

**Load:** 300 direct requests to each Pod, then wait for the next metrics scrape.

```console
$ kubectl exec client -- sh -c 'for i in $(seq 1 300); do wget -qO- http://10.42.2.12:8080/ >/dev/null; done'
```

```console
$ kubectl exec client -- sh -c 'for i in $(seq 1 300); do wget -qO- http://10.42.1.10:8080/ >/dev/null; done'
```

```console
$ kubectl top pods -l app=cs554-midterm
NAME                             CPU(cores)   MEMORY(bytes)   
cs554-midterm-6fcc4dd5b6-ksdlb   1m           21Mi            
cs554-midterm-6fcc4dd5b6-vcglp   4m           21Mi            
```

**cgroup v2 view:** `anon` is the Node process's own memory. `file` is page cache, charged to whichever cgroup first read those files on the node, so it varies between Pods. `memory.max` and `cpu.max` are the limits the kernel enforces.

```console
$ kubectl exec cs554-midterm-6fcc4dd5b6-ksdlb -- sh -c "grep -E '^(anon|file) ' /sys/fs/cgroup/memory.stat | awk '{printf \"%-6s %6.1f MiB\\n\", \$1, \$2/1048576}'; echo memory.max \$(cat /sys/fs/cgroup/memory.max); echo cpu.max \$(cat /sys/fs/cgroup/cpu.max)"
anon     20.8 MiB
file      0.0 MiB
memory.max 134217728
cpu.max 25000 100000
```

```console
$ kubectl exec cs554-midterm-6fcc4dd5b6-vcglp -- sh -c "grep -E '^(anon|file) ' /sys/fs/cgroup/memory.stat | awk '{printf \"%-6s %6.1f MiB\\n\", \$1, \$2/1048576}'; echo memory.max \$(cat /sys/fs/cgroup/memory.max); echo cpu.max \$(cat /sys/fs/cgroup/cpu.max)"
anon     20.8 MiB
file      0.0 MiB
memory.max 134217728
cpu.max 25000 100000
```

**Scheduler view:** requests are reserved on the node even while the Pod is idle.

```console
$ kubectl describe node $(kubectl get pods -l app=cs554-midterm -o jsonpath='{.items[0].spec.nodeName}') | grep -E 'Namespace +Name|cs554-midterm'
  Namespace                   Name                                       CPU Requests  CPU Limits  Memory Requests  Memory Limits  Age
  default                     cs554-midterm-6fcc4dd5b6-ksdlb             50m (0%)      250m (2%)   64Mi (0%)        128Mi (1%)     96s
```
<!-- /step -->
