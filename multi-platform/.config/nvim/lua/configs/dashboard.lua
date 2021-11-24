return function()
    vim.g.dashboard_default_executive = "telescope"
    vim.g.dashboard_custom_section = {
        a = {
            description = { "Recently opened files                        <Space> f h" },
            command = ":Telescope oldfiles",
        },
        b = {
            description = { "Find file                                    <Space> f f" },
            command = ":Telescope find_files",
        },
        c = {
            description = { "Search text                                  <Space> f g" },
            command = ":Telescope live_grep",
        },
        d = {
            description = { "Change colorscheme                :Telescope colorscheme" },
            command = ":Telescope colorscheme",
        },
    }

    vim.g.dashboard_custom_footer = { "Happy coding!" }
    vim.g.dashboard_custom_header = {
        "                                   ",
        "                                   ",
        "                                   ",
        "                                   ",
        "                                   ",
        "          ▀████▀▄▄              ▄█ ",
        "            █▀    ▀▀▄▄▄▄▄    ▄▄▀▀█ ",
        "    ▄        █          ▀▀▀▀▄  ▄▀  ",
        "   ▄▀ ▀▄      ▀▄              ▀▄▀  ",
        "  ▄▀    █     █▀   ▄█▀▄      ▄█    ",
        "  ▀▄     ▀▄  █     ▀██▀     ██▄█   ",
        "   ▀▄    ▄▀ █   ▄██▄   ▄  ▄  ▀▀ █  ",
        "    █  ▄▀  █    ▀██▀    ▀▀ ▀▀  ▄▀  ",
        "   █   █  █      ▄▄           ▄▀   ",
    }
end
