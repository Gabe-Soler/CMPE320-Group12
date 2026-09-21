CXX      ?= c++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra
INCLUDES  = -Ithird_party -Ithird_party/asio/include
LDFLAGS   = -pthread

WEB_ROOT ?= ../Front-End/dist
PORT     ?= 8080

SRC_DIR   = src
BUILD_DIR = build
TARGET    = $(BUILD_DIR)/server

SOURCES = $(wildcard $(SRC_DIR)/*.cpp)
OBJECTS = $(SOURCES:$(SRC_DIR)/%.cpp=$(BUILD_DIR)/%.o)
DEPFILES = $(OBJECTS:.o=.d)

DEPS_STAMP = third_party/.stamp

.PHONY: all build web run clean distclean deps

build: $(TARGET)

all: web build

deps: $(DEPS_STAMP)

$(DEPS_STAMP): scripts/fetch-deps.sh
	./scripts/fetch-deps.sh
	@touch $@

$(TARGET): $(OBJECTS)
	@mkdir -p $(@D)
	$(CXX) $(OBJECTS) $(LDFLAGS) -o $@

$(BUILD_DIR)/%.o: $(SRC_DIR)/%.cpp $(DEPS_STAMP)
	@mkdir -p $(@D)
	$(CXX) $(CXXFLAGS) $(INCLUDES) -MMD -MP -c $< -o $@

web:
	cd ../Front-End && npm install && npm run build

run: $(TARGET)
	WEB_ROOT=$(WEB_ROOT) PORT=$(PORT) $(TARGET)

clean:
	rm -rf $(BUILD_DIR)

distclean: clean
	rm -rf third_party

-include $(DEPFILES)
