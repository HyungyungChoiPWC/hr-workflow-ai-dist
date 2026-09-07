#!/bin/bash
# =====================================================
#  HR Workflow Builder - Mac 더블클릭 실행 파일
#  이 파일을 더블클릭하면 자동으로 설치 및 실행됩니다.
# =====================================================

# 이 파일이 있는 폴더로 이동
cd "$(dirname "$0")"

clear
echo ""
echo "======================================================"
echo "  HR Workflow Builder - 시작 중..."
echo "======================================================"
echo ""

# -- 1. Node.js 확인 --
if ! command -v node &> /dev/null; then
    echo "❌ Node.js가 설치되어 있지 않습니다."
    echo ""
    echo "  아래 주소에서 Node.js LTS 버전을 설치하세요:"
    echo "  👉 https://nodejs.org/ko"
    echo ""
    echo "  설치 후 이 파일을 다시 더블클릭하세요."
    echo ""
    read -p "아무 키나 누르면 창이 닫힙니다..."
    exit 1
fi

echo "✅ Node.js $(node -v) 확인"

# -- 2. npm 확인 --
if ! command -v npm &> /dev/null; then
    echo "❌ npm을 찾을 수 없습니다. Node.js를 다시 설치하세요."
    read -p "아무 키나 누르면 창이 닫힙니다..."
    exit 1
fi

echo "✅ npm v$(npm -v) 확인"

# -- 2.5. 설정 파일 복원 (메일 패키징 시 .mjs → .mjs.txt 변환됨) --
for f in *.mjs.txt; do
    [ -e "$f" ] || continue
    target="${f%.txt}"
    mv "$f" "$target"
    echo "✅ 복원: $target"
done

# -- 3. 패키지 설치 (최초 1회) --
if [ ! -d "node_modules" ]; then
    echo ""
    echo "📦 패키지 설치 중... (최초 실행 시 수분 소요)"
    echo ""
    npm install --legacy-peer-deps
    if [ $? -ne 0 ]; then
        echo ""
        echo "❌ 패키지 설치 실패. 인터넷 연결을 확인하세요."
        read -p "아무 키나 누르면 창이 닫힙니다..."
        exit 1
    fi
    echo ""
    echo "✅ 패키지 설치 완료"
else
    echo "✅ 패키지 이미 설치됨"
fi

# -- 3.5. .env.local 확인 (OpenAI API Key) --
if [ ! -f ".env.local" ]; then
    echo ""
    echo "⚠️  .env.local 파일이 없습니다."
    echo "   AI 워크플로우 기능에는 OpenAI API Key가 필요합니다."
    echo ""
    read -p "OpenAI API Key를 입력하세요 (건너뛰려면 Enter): " API_KEY
    if [ -n "$API_KEY" ]; then
        echo "OPENAI_API_KEY=\"$API_KEY\"" > .env.local
        echo "✅ .env.local 생성 완료"
    else
        echo "OPENAI_API_KEY=\"\"" > .env.local
        echo "⏭  API Key 없이 진행합니다. AI 기능은 사용할 수 없습니다."
    fi
else
    echo "✅ .env.local 확인됨"
fi

# -- 4. 서버 시작 --
echo ""
echo "======================================================"
echo "  🚀 서버 시작 중..."
echo "  📌 주소: http://localhost:3000"
echo "  ⏹  종료: 이 창을 닫거나 Ctrl+C"
echo "======================================================"
echo ""

# 2초 후 브라우저 자동 오픈
(sleep 2 && open "http://localhost:3000") &

npx next dev --turbopack -p 3000
