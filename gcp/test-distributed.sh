#!/bin/bash
# ==============================================================================
# Test script to verify distributed whiteboard functionality
# ==============================================================================

echo "Testing Distributed Whiteboard Setup"
echo "====================================="

# Configuration
NODE1_URL="${NODE1_URL:-http://localhost:8081}"
NODE2_URL="${NODE2_URL:-http://localhost:8082}"
WHITEBOARD_ID="test-$(date +%s)"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; }

# Test 1: Health check on Node 1
echo ""
echo "[Test 1] Health check - Node 1"
HEALTH1=$(curl -s "$NODE1_URL/api/health")
if [ $? -eq 0 ] && [[ $HEALTH1 == *"healthy"* ]]; then
    pass "Node 1 is healthy"
    echo "  Response: $HEALTH1"
else
    fail "Node 1 health check failed"
fi

# Test 2: Health check on Node 2
echo ""
echo "[Test 2] Health check - Node 2"
HEALTH2=$(curl -s "$NODE2_URL/api/health")
if [ $? -eq 0 ] && [[ $HEALTH2 == *"healthy"* ]]; then
    pass "Node 2 is healthy"
    echo "  Response: $HEALTH2"
else
    fail "Node 2 health check failed"
fi

# Test 3: Node info - verify distributed mode
echo ""
echo "[Test 3] Verify distributed mode"
INFO1=$(curl -s "$NODE1_URL/api/node-info")
if [[ $INFO1 == *"distributed\":true"* ]]; then
    pass "Node 1 is in distributed mode"
else
    fail "Node 1 is not in distributed mode"
fi

INFO2=$(curl -s "$NODE2_URL/api/node-info")
if [[ $INFO2 == *"distributed\":true"* ]]; then
    pass "Node 2 is in distributed mode"
else
    fail "Node 2 is not in distributed mode"
fi

# Test 4: Draw to whiteboard via Node 1
echo ""
echo "[Test 4] Draw to whiteboard via Node 1"
DRAW_RESULT=$(curl -s "$NODE1_URL/api/drawToWhiteboard?wid=$WHITEBOARD_ID&t=line&d=%5B100,100,200,200%5D&th=5&c=%23000000")
if [[ $DRAW_RESULT == "done" ]]; then
    pass "Drawing created on Node 1"
else
    fail "Failed to create drawing on Node 1"
fi

# Wait for sync
sleep 1

# Test 5: Load whiteboard from Node 2 (verify sync)
echo ""
echo "[Test 5] Verify whiteboard sync on Node 2"
LOAD_RESULT=$(curl -s "$NODE2_URL/api/loadwhiteboard?wid=$WHITEBOARD_ID")
if [[ $LOAD_RESULT == *"line"* ]]; then
    pass "Drawing synced to Node 2"
else
    fail "Drawing not synced to Node 2"
fi

# Test 6: Draw another shape on Node 2
echo ""
echo "[Test 6] Draw to whiteboard via Node 2"
DRAW_RESULT2=$(curl -s "$NODE2_URL/api/drawToWhiteboard?wid=$WHITEBOARD_ID&t=circle&d=%5B300,300,50%5D&th=3&c=%23ff0000")
if [[ $DRAW_RESULT2 == "done" ]]; then
    pass "Drawing created on Node 2"
else
    fail "Failed to create drawing on Node 2"
fi

sleep 1

# Test 7: Verify both drawings on Node 1
echo ""
echo "[Test 7] Verify all drawings on Node 1"
LOAD_RESULT2=$(curl -s "$NODE1_URL/api/loadwhiteboard?wid=$WHITEBOARD_ID")
if [[ $LOAD_RESULT2 == *"line"* ]] && [[ $LOAD_RESULT2 == *"circle"* ]]; then
    pass "Both drawings synced to Node 1"
else
    fail "Not all drawings synced to Node 1"
fi

echo ""
echo "====================================="
echo "Test Complete!"
echo ""
echo "Access your whiteboard at:"
echo "  Node 1: $NODE1_URL/?whiteboardid=$WHITEBOARD_ID"
echo "  Node 2: $NODE2_URL/?whiteboardid=$WHITEBOARD_ID"
