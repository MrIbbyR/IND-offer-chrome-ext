#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cat > unbound-configmap.yaml << 'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: unbound-config
  namespace: pihole
data:
  unbound.conf: |
    server:
      verbosity: 0
      interface: 127.0.0.1
      port: 5335
      do-ip4: yes
      do-udp: yes
      do-tcp: yes
      root-hints: "/var/unbound/root.hints"
      hide-identity: yes
      hide-version: yes
      harden-glue: yes
      use-caps-for-id: yes
      cache-min-ttl: 3600
      cache-max-ttl: 86400
      prefetch: yes
      qname-minimisation: yes
EOF

cat > pihole-deployment-unbound-sidecar.patch.yaml << 'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: pihole
  namespace: pihole
spec:
  template:
    spec:
      containers:
        - name: pihole
          env:
            - name: FTLCONF_dns_upstreams
              value: "127.0.0.1#5335"
        - name: unbound
          image: klutchell/unbound:latest
          imagePullPolicy: IfNotPresent
          volumeMounts:
            - name: unbound-config
              mountPath: /etc/unbound/unbound.conf
              subPath: unbound.conf
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              memory: 256Mi
      volumes:
        - name: unbound-config
          configMap:
            name: unbound-config
EOF

echo "Applying Unbound ConfigMap and patching Pi-hole Deployment..."
kubectl apply -f unbound-configmap.yaml
kubectl patch deployment pihole -n pihole --type strategic --patch-file pihole-deployment-unbound-sidecar.patch.yaml
kubectl rollout status deployment/pihole -n pihole

echo "Done. Check: kubectl get pods -n pihole"
kubectl get pods -n pihole
