#!/bin/bash

# ====== 用户配置项 ======
INSTANCE_ID="i-00609028a1dcbcb3c"
REGION="ap-southeast-1"
WARNING_THRESHOLD_GB=90
CRITICAL_THRESHOLD_GB=97

# Telegram 配置
BOT_TOKEN="7916165386:AAGFq_paj3Yh8Ei66VpbHio46ybOLv9gSUc"
CHAT_ID="5848244735"

# ====== 函数定义 ======
send_telegram() {
    local MESSAGE=$1
    curl -s -X POST "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" \
        -d chat_id="$CHAT_ID" \
        -d text="$MESSAGE"
}

limit_bandwidth() {
    IFACE=$(ip route get 8.8.8.8 | awk '{print $5; exit}')
    tc qdisc del dev $IFACE root 2>/dev/null
    tc qdisc add dev $IFACE root tbf rate 128kbit burst 32kbit latency 400ms
    echo "限速已设置在接口 $IFACE"
}

remove_bandwidth_limit() {
    IFACE=$(ip route get 8.8.8.8 | awk '{print $5; exit}')
    tc qdisc del dev $IFACE root 2>/dev/null
    echo "限速已移除"
}

# ====== 日期设置 ======
START_DATE=$(date -u -d "$(date +%Y-%m-01) 00:00:00" +%Y-%m-%dT%H:%M:%SZ)
END_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# ====== 获取流量数据 ======
OUT_BYTES=$(/usr/bin/aws cloudwatch get-metric-statistics \
  --metric-name NetworkOut \
  --start-time "$START_DATE" \
  --end-time "$END_DATE" \
  --period 86400 \
  --namespace AWS/EC2 \
  --statistics Sum \
  --dimensions Name=InstanceId,Value=$INSTANCE_ID \
  --region $REGION \
  --query "Datapoints[*].Sum" \
  --output text | awk '{s+=$1} END {print s}')

# 避免空值
if [ -z "$OUT_BYTES" ]; then
    echo "无法获取流量数据，跳过本次运行"
    send_telegram "错误：脚本无法获取出站流量数据，请检查 AWS CLI 配置或 IAM 权限。"
    exit 1
fi

OUT_GB=$(echo "scale=2; $OUT_BYTES / 1024 / 1024 / 1024" | bc)
echo "$(date): 本月出站流量为 $OUT_GB GB"

# ====== 每月自动解除限速 ======
DAY_OF_MONTH=$(date +%d)
if (( DAY_OF_MONTH <= 3 )); then
    echo "月初，解除带宽限制"
    remove_bandwidth_limit
fi

# ====== 判断并执行限速或通知 ======
if (( $(echo "$OUT_GB > $CRITICAL_THRESHOLD_GB" | bc -l) )); then
    send_telegram "严重警告：EC2出站流量已达 $OUT_GB GB，执行限速操作！"
    limit_bandwidth
elif (( $(echo "$OUT_GB > $WARNING_THRESHOLD_GB" | bc -l) )); then
    send_telegram "警告：EC2本月出站流量已达 $OUT_GB GB，请注意控制！"
    remove_bandwidth_limit
else
    remove_bandwidth_limit
fi
