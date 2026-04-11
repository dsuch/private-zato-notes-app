CMAKE_BUILD_DIR := build
CMAKE_FLAGS ?=

.PHONY: all install clean build run check-lines configure

all: check-lines
	cmake -S . -B $(CMAKE_BUILD_DIR) -Wno-dev $(CMAKE_FLAGS)
	cmake --build $(CMAKE_BUILD_DIR)

install:
	sudo apt-get update
	sudo apt-get install -y build-essential cmake qt6-base-dev libqscintilla2-qt6-dev pkg-config libxkbcommon-dev

clean:
	rm -rf $(CMAKE_BUILD_DIR)

configure:
	cmake -S . -B $(CMAKE_BUILD_DIR) -Wno-dev $(CMAKE_FLAGS)

build: all

run: all
	cd "$(CURDIR)" && "$(CURDIR)/$(CMAKE_BUILD_DIR)/notes-app"

check-lines:
	@for f in src/*.cpp src/*.h; do \
		test -f $$f || continue; \
		n=$$(wc -l < $$f); \
		if [ $$n -gt 500 ]; then echo "$$f has $$n lines (max 500)"; exit 1; fi; \
	done
