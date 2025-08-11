return {
  "ThePrimeagen/harpoon",
  branch = "harpoon2",
  dependencies = {
    "nvim-lua/plenary.nvim",
    "nvim-telescope/telescope.nvim",
  },
  config = function()
    local harpoon = require("harpoon")
    harpoon:setup()

    require("which-key").add({
      { "<leader>h", group = "Harpoon" },
      {
        "<leader>hh",
        function()
          harpoon.ui:toggle_quick_menu(harpoon:list())
        end,
        desc = "Open harpoon window",
      },
      {
        "]h",
        function()
          harpoon:list():next()
        end,
        desc = "Go to next Harpoon file",
      },
      {
        "[h",
        function()
          harpoon:list():prev()
        end,
        desc = "Go to previous Harpoon file",
      },
      {
        "<leader>ha",
        function()
          harpoon:list():add()
        end,
        desc = "Add file to Harpoon list",
      },
      {
        "<C-h>",
        function()
          harpoon:list():select(1)
        end,
        desc = "Go to Harpoon file 1",
      },
      {
        "<C-j>",
        function()
          harpoon:list():select(2)
        end,
        desc = "Go to Harpoon file 2",
      },
      {
        "<C-k>",
        function()
          harpoon:list():select(3)
        end,
        desc = "Go to Harpoon file 3",
      },
      {
        "<C-l>",
        function()
          harpoon:list():select(4)
        end,
        desc = "Go to Harpoon file 4",
      },
    })
  end,
}
