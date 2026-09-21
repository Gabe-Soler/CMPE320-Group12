#include <cstdlib>
#include <filesystem>
#include <string>

#include "api_routes.h"
#include "crow_all.h"
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
}

int main()
{
    const std::uint16_t port = resolve_port();

    std::error_code ec;
    const fs::path web_root =
      fs::weakly_canonical(env_or("WEB_ROOT", "../Front-End/dist"), ec);

    crow::SimpleApp app;

    register_api_routes(app);
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
