#!/usr/bin/env bash
# Run ON the Raspberry Pi (SSH). Fixes common Pi-hole + MetalLB + k3s DNS timeouts.
set -euo pipefail
NS=pihole
SVC=pihole-lb

echo "=== 1) Pod status ==="
kubectl get pods -n "$NS" -o wide

echo ""
echo "=== 2) Service + endpoints (must have endpoints for :53) ==="
kubectl get svc "$SVC" -n "$NS" -o wide
kubectl get endpoints "$SVC" -n "$NS" -o yaml | sed -n '1,40p'

echo ""
echo "=== 3) Patch LoadBalancer: externalTrafficPolicy -> Cluster ==="
echo "    (Local can drop/hairpin UDP to the VIP on single-node setups.)"
kubectl apply -f "$(dirname "$0")/pihole-lb-service-cluster-policy.yaml"

echo ""
echo "=== 4) Wait for kube-proxy to reconcile (few seconds) ==="
sleep 3

CLUSTER_IP=$(kubectl get svc "$SVC" -n "$NS" -o jsonpath='{.spec.clusterIP}')
NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
NODEPORT_DNS=$(kubectl get svc "$SVC" -n "$NS" -o go-template='{{range .spec.ports}}{{if eq .name "dns-udp"}}{{.nodePort}}{{end}}{{end}}')
if [[ -z "${NODEPORT_DNS:-}" ]]; then
  NODEPORT_DNS=$(kubectl get svc "$SVC" -n "$NS" -o jsonpath='{.spec.ports[0].nodePort}')
fi

echo ""
echo "=== 5) In-cluster UDP test (bypasses MetalLB VIP) ==="
kubectl run dns-test-"$(date +%s)" --rm -i --restart=Never --image=busybox:1.36 -n "$NS" -- \
  sh -c "nslookup google.com $CLUSTER_IP || true" 2>&1 | tail -20

echo ""
echo "=== 6) On this Pi: NodePort UDP (bypasses MetalLB .200 VIP) ==="
echo "    dig @${NODE_IP} -p ${NODEPORT_DNS} google.com +short +time=2"
if command -v dig >/dev/null 2>&1; then
  dig @"${NODE_IP}" -p "${NODEPORT_DNS}" google.com +short +time=2 || true
else
  echo "    (install dnsutils: sudo apt install -y dnsutils)"
fi

echo ""
echo "=== 7) Inside Pi-hole pod: UDP vs TCP to localhost:53 ==="
kubectl exec -n "$NS" deploy/pihole -c pihole -- sh -c \
  'dig @127.0.0.1 google.com +short +time=2; echo "---"; dig @127.0.0.1 google.com +tcp +short +time=2' || true

echo ""
echo "=== 8) MetalLB VIP (should work from other PCs after step 3) ==="
echo "    dig @192.168.1.200 google.com +short +time=2"
if command -v dig >/dev/null 2>&1; then
  dig @192.168.1.200 google.com +short +time=2 || true
fi

echo ""
echo "=== Done ==="
echo "From Windows, test:  nslookup google.com 192.168.1.200"
echo "If still timeout: disable VPN, check Wi-Fi client isolation on router, try Ethernet."
