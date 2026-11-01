#!/bin/zsh
cd -- "$(dirname "$0")"
/Library/Frameworks/Python.framework/Versions/3.12/bin/python3 scripts/review_remote.py start
read -r '?按回车关闭此窗口…'
