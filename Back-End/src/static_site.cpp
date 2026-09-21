#include "static_site.h"

#include <system_error>

namespace fs = std::filesystem;

namespace
{
    fs::path resolve_within(const fs::path& web_root, const std::string& relative)
    {
        std::error_code ec;
        const fs::path candidate = fs::weakly_canonical(web_root / relative, ec);
        if (ec) return {};

        const fs::path relation = candidate.lexically_relative(web_root);
        if (relation.empty() || *relation.begin() == "..") return {};

        return candidate;
    }

    void serve_file(crow::response& res, const fs::path& file)
    {
        res.set_static_file_info_unsafe(file.string());
        res.end();
    }

    void serve_index(crow::response& res, const fs::path& web_root)
    {
        const fs::path index = web_root / "index.html";
        if (!fs::is_regular_file(index))
        {
            res.code = crow::status::NOT_FOUND;
            res.body = "Front-end build not found. Run `make web` in Back-End/.";
            res.end();
            return;
        }
        serve_file(res, index);
    }
}

void register_static_site(crow::SimpleApp& app, const fs::path& web_root)
{
    CROW_ROUTE(app, "/")
    ([web_root](const crow::request&, crow::response& res) {
        serve_index(res, web_root);
    });

    CROW_ROUTE(app, "/<path>")
    ([web_root](const crow::request&, crow::response& res, const std::string& path) {
        const fs::path file = resolve_within(web_root, path);

        if (!file.empty() && fs::is_regular_file(file))
        {
            serve_file(res, file);
            return;
        }

        if (path.rfind("api/", 0) == 0)
        {
            res.code = crow::status::NOT_FOUND;
            res.body = R"({"error":"no such endpoint"})";
            res.set_header("Content-Type", "application/json");
            res.end();
            return;
        }

        serve_index(res, web_root);
    });
}
