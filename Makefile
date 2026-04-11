.PHONY: install clean build run test

NODE_VERSION := 22

install:
	@if ! command -v node > /dev/null 2>&1; then \
		echo "Installing Node.js $(NODE_VERSION).x ..."; \
		curl -fsSL https://deb.nodesource.com/setup_$(NODE_VERSION).x | sudo -E bash -; \
		sudo apt-get install -y nodejs; \
	fi
	npm install

clean:
	rm -rf node_modules dist build .cache

build:
	node build.js

run:
	npx electron . --no-sandbox

test:
	node test/test_first_line.js
	node test/test_code_block.js
