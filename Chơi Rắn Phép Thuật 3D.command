#!/bin/zsh

set -u

SCRIPT_DIR="${0:A:h}"
cd "$SCRIPT_DIR" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
  source "${HOME}/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "❌ Không tìm thấy Node.js / npm trên máy Mac."
  echo "👉 Bố mẹ vui lòng cài Node.js (>= 22) từ https://nodejs.org rồi mở lại file này nhé!"
  read -r "?Nhấn Enter để đóng cửa sổ..."
  exit 1
fi

if [[ ! -d "node_modules" ]]; then
  echo "📦 Lần chạy đầu tiên: đang cài đặt các gói cần thiết..."
  npm install || {
    echo "❌ Cài đặt thất bại. Vui lòng kiểm tra kết nối mạng."
    read -r "?Nhấn Enter để đóng cửa sổ..."
    exit 1
  }
fi

PORT=5173
while lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; do
  PORT=$((PORT + 1))
  if (( PORT > 5190 )); then
    echo "❌ Không tìm thấy cổng trống từ 5173 đến 5190."
    read -r "?Nhấn Enter để đóng cửa sổ..."
    exit 1
  fi
done

URL="http://localhost:${PORT}"

clear
echo "============================================================"
echo "  ✨ VƯƠNG QUỐC RẮN PHÉP THUẬT 3D — DualSense macOS ✨"
echo "============================================================"
echo "🌐 Địa chỉ trò chơi: ${URL}"
echo "🎮 Mẹo hay: Cắm dây USB-C hoặc ghép đôi Bluetooth tay cầm DualSense."
echo "💡 Để bật Đèn LED đổi màu trên tay cầm, hãy dùng Google Chrome hoặc Edge!"
echo "⏹️  Khi chơi xong, nhấn Ctrl+C hoặc đóng cửa sổ này để tắt máy chủ."
echo "============================================================"
echo ""

open_game_browser() {
  local tries=0
  while (( tries < 40 )); do
    if curl -sf "$URL" >/dev/null 2>&1; then
      break
    fi
    sleep 0.4
    tries=$((tries + 1))
  done

  if [[ -d "/Applications/Google Chrome.app" ]]; then
    echo "🚀 Đang mở bằng Google Chrome (hỗ trợ đầy đủ Đèn LED WebHID DualSense)..."
    open -a "Google Chrome" "$URL"
  elif [[ -d "/Applications/Microsoft Edge.app" ]]; then
    echo "🚀 Đang mở bằng Microsoft Edge (hỗ trợ đầy đủ Đèn LED WebHID DualSense)..."
    open -a "Microsoft Edge" "$URL"
  else
    echo "🚀 Đang mở bằng trình duyệt mặc định của macOS..."
    echo "💡 Ghi chú: Safari hỗ trợ tay cầm & rung, còn Chrome/Edge hỗ trợ thêm Đèn LED WebHID."
    open "$URL"
  fi
}

open_game_browser &

npm run dev -- --port "$PORT"
