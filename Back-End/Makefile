CXX      ?= c++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra
INCLUDES  = -Ithird_party -Ithird_party/asio/include -Isrc
LDFLAGS   = -pthread

WEB_ROOT ?= ../Front-End/dist
PORT     ?= 8080

SRC_DIR   = src
BUILD_DIR = build
TARGET    = $(BUILD_DIR)/server

SOURCES = $(wildcard $(SRC_DIR)/*.cpp)
OBJECTS = $(SOURCES:$(SRC_DIR)/%.cpp=$(BUILD_DIR)/%.o)

# Tests link every module except main.cpp.
TEST_DIR     = tests
TEST_SOURCES = $(wildcard $(TEST_DIR)/*.cpp)
TEST_OBJECTS = $(TEST_SOURCES:$(TEST_DIR)/%.cpp=$(BUILD_DIR)/tests/%.o)
LIB_OBJECTS  = $(filter-out $(BUILD_DIR)/main.o,$(OBJECTS))
TEST_TARGET  = $(BUILD_DIR)/run_tests

DEPFILES = $(OBJECTS:.o=.d) $(TEST_OBJECTS:.o=.d)

DEPS_STAMP = third_party/.stamp

.PHONY: all build web run test clean distclean deps

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

$(BUILD_DIR)/tests/%.o: $(TEST_DIR)/%.cpp $(DEPS_STAMP)
	@mkdir -p $(@D)
	$(CXX) $(CXXFLAGS) $(INCLUDES) -MMD -MP -c $< -o $@

$(TEST_TARGET): $(LIB_OBJECTS) $(TEST_OBJECTS)
	@mkdir -p $(@D)
	$(CXX) $^ $(LDFLAGS) -o $@

test: $(TEST_TARGET)
	./$(TEST_TARGET)

web:
	cd ../Front-End && npm install && npm run build

run: $(TARGET)
	WEB_ROOT=$(WEB_ROOT) PORT=$(PORT) DATA_DIR=data $(TARGET)

clean:
	rm -rf $(BUILD_DIR)

distclean: clean
	rm -rf third_party

-include $(DEPFILES)
