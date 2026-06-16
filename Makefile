INCLUDES := --include commands --include containers --include generators --include recipes --include renderers --include decker.example.ts
OUTPUT   ?= decker
TARGET   ?=

.PHONY: compile install uninstall

# Compile a standalone binary (host target by default; set TARGET= to cross-compile).
compile:
	rm -f $(OUTPUT)
	deno compile --allow-all $(INCLUDES) $(if $(TARGET),--target $(TARGET),) --output $(OUTPUT) cli.ts

# Install to /usr/local/bin (same path as install.sh).
install:
	sudo $(MAKE) compile OUTPUT=/usr/local/bin/decker
