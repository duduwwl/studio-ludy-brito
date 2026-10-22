#!/usr/bin/env bash
# Reinicia o servidor local de testes (porta 8787 por padrão).
PORT=${1:-8787}
PIDFILE=/tmp/lb-mock-$PORT.pid
[ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null
sleep 0.3
cd "$(dirname "$0")/../.." && nohup python3 tests/mock/server.py "$PORT" > /tmp/lb-mock-$PORT.log 2>&1 &
echo $! > "$PIDFILE"
sleep 1
echo "servidor local em http://localhost:$PORT"
