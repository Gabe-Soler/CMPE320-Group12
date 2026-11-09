#include <cstdlib>
#include <filesystem>
#include <memory>
#include <string>

#include "api_routes.h"
#include "crow_all.h"
#include "data_loader.h"
#include "static_site.h"

namespace fs = std::filesystem;

namespace
{
    std::string env_or(const char* name, const std::string& fallback)
    {
        const char* value = std::getenv(name);
        return (value != nullptr && *value != '\0') ? std::string(value) : fallback;
    }

    std::uint16_t resolve_port()
    {
        const std::string raw = env_or("PORT", "8080");
        try
        {
            const int parsed = std::stoi(raw);
            if (parsed > 0 && parsed <= 65535)
                return static_cast<std::uint16_t>(parsed);
        }
        catch (const std::exception&)
        {
        }

        CROW_LOG_WARNING << "PORT=\"" << raw << "\" is not a valid port, using 8080";
        return 8080;
    }

    /// Loads one CSV, logging every skipped row so data mistakes are easy to find.
    template <typename Loader>
    auto load_logged(const fs::path& file, Loader loader)
    {
        auto result = loader(file);
        for (const auto& warning : result.warnings)
            CROW_LOG_WARNING << file.filename().string() << " " << warning << " (skipped)";
        CROW_LOG_INFO << "loaded " << result.items.size() << " rows from " << file;
        return std::move(result.items);
    }
}

int main()
{
    const std::uint16_t port = resolve_port();

    std::error_code ec;
    const fs::path web_root =
      fs::weakly_canonical(env_or("WEB_ROOT", "../Front-End/dist"), ec);
    const fs::path data_dir = env_or("DATA_DIR", "data");

    // Read the data once at startup; requests only ever read it, so no locking is needed.
    std::unique_ptr<const bib::AppData> data;
    try
    {
        data = std::make_unique<const bib::AppData>(bib::AppData{
          bib::Recommender(load_logged(data_dir / "Activities.csv", bib::load_activities)),
          load_logged(data_dir / "locations.csv", bib::load_locations)});
    }
    catch (const std::exception& e)
    {
        CROW_LOG_CRITICAL << "could not load data from " << data_dir << ": " << e.what()
                          << " (set DATA_DIR to the folder holding Activities.csv and locations.csv)";
        return 1;
    }
    CROW_LOG_INFO << data->recommender.activities().size() << " activities are within walking range of campus";

    crow::SimpleApp app;

    bib::register_api_routes(app, *data);
    register_static_site(app, web_root);

    if (ec || !fs::is_directory(web_root))
    {
        CROW_LOG_WARNING << "front-end build not found at " << web_root
                         << " - the API works, but pages will 404. "
                            "Run `make web` (or set WEB_ROOT) to fix this.";
    }
    else
    {
        CROW_LOG_INFO << "serving front-end from " << web_root;
    }

    app.bindaddr("0.0.0.0").port(port).multithreaded().run();
    return 0;
}
