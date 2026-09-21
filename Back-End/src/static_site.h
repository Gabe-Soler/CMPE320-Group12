#pragma once

#include <filesystem>

#include "crow_all.h"

void register_static_site(crow::SimpleApp& app, const std::filesystem::path& web_root);
