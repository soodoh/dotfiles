return {
  {
    "ravitemer/mcphub.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
    },
    build = "npm install -g mcp-hub@latest", -- Installs `mcp-hub` node binary globally
    config = function()
      require("mcphub").setup({
        config = vim.fn.expand("~/.config/mcphub/servers.json"),
      })

      require("which-key").add({
        {
          "<leader>cm",
          ":MCPHub<CR>",
          desc = "MCP Hub",
        },
      })
    end,
  },
  {
    "olimorris/codecompanion.nvim",
    opts = {},
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-treesitter/nvim-treesitter",
    },
    config = function()
      require("codecompanion").setup({
        strategies = {
          chat = {
            adapter = "anthropic",
            model = "claude-3.7-sonnet",
            keymaps = {
              options = {
                modes = {
                  n = "?",
                },
                callback = "keymaps.options",
                description = "Options",
                hide = true,
              },
              completion = {
                modes = {
                  i = "<C-_>",
                },
                index = 1,
                callback = "keymaps.completion",
                description = "Completion Menu",
              },
              send = {
                modes = {
                  n = { "<CR>", "<C-s>" },
                  i = "<C-s>",
                },
                index = 2,
                callback = "keymaps.send",
                description = "Send",
              },
              regenerate = {
                modes = {
                  n = "gr",
                },
                index = 3,
                callback = "keymaps.regenerate",
                description = "Regenerate the last response",
              },
              close = {
                modes = {
                  n = "<C-c>",
                  i = "<C-c>",
                },
                index = 4,
                callback = "keymaps.close",
                description = "Close Chat",
              },
              stop = {
                modes = {
                  n = "q",
                },
                index = 5,
                callback = "keymaps.stop",
                description = "Stop Request",
              },
              clear = {
                modes = {
                  n = "gx",
                },
                index = 6,
                callback = "keymaps.clear",
                description = "Clear Chat",
              },
              codeblock = {
                modes = {
                  n = "gc",
                },
                index = 7,
                callback = "keymaps.codeblock",
                description = "Insert Codeblock",
              },
              yank_code = {
                modes = {
                  n = "gy",
                },
                index = 8,
                callback = "keymaps.yank_code",
                description = "Yank Code",
              },
              pin = {
                modes = {
                  n = "gp",
                },
                index = 9,
                callback = "keymaps.pin_reference",
                description = "Pin Reference",
              },
              watch = {
                modes = {
                  n = "gw",
                },
                index = 10,
                callback = "keymaps.toggle_watch",
                description = "Watch Buffer",
              },
              next_chat = {
                modes = {
                  n = "}",
                },
                index = 11,
                callback = "keymaps.next_chat",
                description = "Next Chat",
              },
              previous_chat = {
                modes = {
                  n = "{",
                },
                index = 12,
                callback = "keymaps.previous_chat",
                description = "Previous Chat",
              },
              next_header = {
                modes = {
                  n = "]]",
                },
                index = 13,
                callback = "keymaps.next_header",
                description = "Next Header",
              },
              previous_header = {
                modes = {
                  n = "[[",
                },
                index = 14,
                callback = "keymaps.previous_header",
                description = "Previous Header",
              },
              change_adapter = {
                modes = {
                  n = "ga",
                },
                index = 15,
                callback = "keymaps.change_adapter",
                description = "Change adapter",
              },
              fold_code = {
                modes = {
                  n = "gf",
                },
                index = 15,
                callback = "keymaps.fold_code",
                description = "Fold code",
              },
              debug = {
                modes = {
                  n = "gd",
                },
                index = 16,
                callback = "keymaps.debug",
                description = "View debug info",
              },
              system_prompt = {
                modes = {
                  n = "gs",
                },
                index = 17,
                callback = "keymaps.toggle_system_prompt",
                description = "Toggle the system prompt",
              },
              auto_tool_mode = {
                modes = {
                  n = "gta",
                },
                index = 18,
                callback = "keymaps.auto_tool_mode",
                description = "Toggle automatic tool mode",
              },
              goto_file_under_cursor = {
                modes = { n = "gR" },
                index = 19,
                callback = "keymaps.goto_file_under_cursor",
                description = "Open the file under cursor in a new tab.",
              },
            },
          },
          inline = {
            adapter = "anthropic",
            model = "claude-3.7-sonnet",
            keymaps = {
              accept_change = {
                modes = {
                  n = "ga",
                },
                index = 1,
                callback = "keymaps.accept_change",
                description = "Accept change",
              },
              reject_change = {
                modes = {
                  n = "gr",
                },
                index = 2,
                callback = "keymaps.reject_change",
                description = "Reject change",
              },
            },
            variables = {
              ["buffer"] = {
                callback = "strategies.inline.variables.buffer",
                description = "Share the current buffer with the LLM",
                opts = {
                  contains_code = true,
                },
              },
              ["chat"] = {
                callback = "strategies.inline.variables.chat",
                description = "Share the currently open chat buffer with the LLM",
                opts = {
                  contains_code = true,
                },
              },
              ["clipboard"] = {
                callback = "strategies.inline.variables.clipboard",
                description = "Share the contents of the clipboard with the LLM",
                opts = {
                  contains_code = true,
                },
              },
            },
          },
        },
        dependencies = {
          "ravitemer/mcphub.nvim",
        },
        extensions = {
          mcphub = {
            callback = "mcphub.extensions.codecompanion",
            opts = {
              show_result_in_chat = true, -- Show mcp tool results in chat
              make_vars = true, -- Convert resources to #variables
              make_slash_commands = true, -- Add prompts as /slash commands
            },
          },
        },
      })

      require("which-key").add({
        {
          "<leader>c",
          group = "Code Companion",
        },
        {
          "<leader>cc",
          ":CodeCompanionChat<CR>",
          desc = "Open Chat",
        },
        {
          "<leader>ca",
          ":CodeCompanionActions<CR>",
          desc = "Choose Action",
        },
      })
    end,
  },
}
