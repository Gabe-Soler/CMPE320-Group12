#include "api_routes.h"

void register_api_routes(crow::SimpleApp& app)
{
    CROW_ROUTE(app, "/api/health")
    ([] {
        crow::json::wvalue body;
        body["status"] = "ok";
        body["service"] = "cmpe320-group12";
        return body;
    });

    CROW_ROUTE(app, "/api/hello/<string>")
    ([](const std::string& name) {
        crow::json::wvalue body;
        body["greeting"] = "Hello, " + name + "!";
        return body;
    });

    CROW_ROUTE(app, "/api/echo")
        .methods(crow::HTTPMethod::POST)([](const crow::request& req) {
            const auto received = crow::json::load(req.body);
            if (!received)
            {
                crow::json::wvalue error;
                error["error"] = "request body is not valid JSON";
                return crow::response(crow::status::BAD_REQUEST, std::move(error));
            }

            crow::json::wvalue body;
            body["received"] = crow::json::wvalue(received);
            return crow::response(std::move(body));
        });
}
